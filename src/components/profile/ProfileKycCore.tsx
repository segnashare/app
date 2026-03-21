"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Playfair_Display } from "next/font/google";

type ProfileKycCoreProps = {
  backTab: "plus" | "security" | "me";
};

type VerificationStatus = "not_started" | "pending" | "in_review" | "verified" | "rejected";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "800"],
});
const PROFILE_HEADER_CACHE_KEY = "segna:profile:header:v1";

export function ProfileKycCore({ backTab }: ProfileKycCoreProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isStarting, setIsStarting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("not_started");

  const startKyc = async () => {
    setErrorMessage(null);
    setIsStarting(true);
    try {
      const response = await fetch("/api/kyc/stripe/start", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!response.ok || !payload.url) {
        setErrorMessage(payload.message || "Impossible de démarrer la vérification.");
        setIsStarting(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setErrorMessage("Impossible de démarrer la vérification.");
      setIsStarting(false);
    }
  };

  useEffect(() => {
    const kycParam = searchParams.get("kyc");
    let isCancelled = false;

    const syncStatus = async () => {
      setErrorMessage(null);
      setStatusMessage(kycParam === "processing" ? "Vérification en cours de synchronisation..." : "Récupération du statut KYC...");
      setIsSyncing(true);
      try {
        const response = await fetch("/api/kyc/stripe/sync", { method: "POST" });
        const payload = (await response.json().catch(() => ({}))) as {
          verificationStatus?: VerificationStatus;
          message?: string;
        };
        if (isCancelled) return;
        if (!response.ok) {
          setErrorMessage(payload.message || "Impossible de synchroniser le statut KYC.");
          setStatusMessage(null);
          return;
        }

        const nextStatus = payload.verificationStatus ?? "not_started";
        setVerificationStatus(nextStatus);

        if (kycParam === "processing") {
          const nextParams = new URLSearchParams(searchParams.toString());
          nextParams.delete("kyc");
          const nextQuery = nextParams.toString();
          router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
        }

        if (nextStatus === "verified") {
          // Force profile header to refetch fresh KYC status on return.
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(PROFILE_HEADER_CACHE_KEY);
          }
          setStatusMessage("Vérification validée. Ton profil est bien sécurisé.");
          return;
        }
        if (nextStatus === "rejected") {
          setStatusMessage("Vérification refusée. Merci de réessayer avec un document plus lisible.");
          return;
        }
        if (nextStatus === "in_review") {
          setStatusMessage("Vérification transmise. Stripe est en train d'analyser ton dossier.");
          return;
        }
        if (nextStatus === "pending") {
          setStatusMessage("Vérification commencée. Finalise les étapes Stripe pour continuer.");
          return;
        }
        setStatusMessage("Aucune vérification active pour le moment.");
      } catch {
        if (isCancelled) return;
        setErrorMessage("Impossible de synchroniser le statut KYC.");
        setStatusMessage(null);
      } finally {
        if (!isCancelled) setIsSyncing(false);
      }
    };

    void syncStatus();
    return () => {
      isCancelled = true;
    };
  }, [pathname, router, searchParams]);

  const isVerified = verificationStatus === "verified";
  const isRejected = verificationStatus === "rejected";
  const isReviewing = verificationStatus === "in_review" || verificationStatus === "pending";
  const canRetry = !isStarting && !isSyncing;
  const retryLabel = isStarting ? "Redirection..." : isSyncing ? "Synchronisation..." : "Réessayer la vérification";
  const reviewingStatusText = statusMessage || "Merci. Nous vérifions ton identité, cela peut prendre quelques instants.";

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-white px-5 py-6">
      <header className="flex items-center justify-start">
        <Link href={`/profile?tab=${backTab}`} className="inline-flex h-10 items-center text-[18px] font-bold text-[#5E3023]">
          Annuler
        </Link>
      </header>

      {isReviewing ? (
        <section className="mt-6 flex flex-1 flex-col px-2 text-center">
          <div className="flex flex-[2] flex-col items-center justify-center">
            <img src="/ressources/oeil_charme.png" alt="" className="w-[78%] max-w-[300px]" />
            <h1 className={`${playfairDisplay.className} mt-6 max-w-full font-extrabold leading-[1.04] tracking-[-0.03em] text-zinc-950 min-[200px]:text-[38px]`}>
              Vérification en cours
            </h1>
          </div>

          <div className="flex flex-1 flex-col items-center pb-8">
            <p className="mb-1 max-w-[300px] text-[14px] leading-[1.3] text-zinc-500">{reviewingStatusText}</p>
            {errorMessage ? <p className="mb-3 text-sm text-[#E44D3E]">{errorMessage}</p> : null}
            <Link
              href={`/profile?tab=${backTab}`}
              className="inline-flex h-12 min-w-[240px] items-center justify-center rounded-full bg-[#5E3023] px-8 text-[17px] font-semibold text-white transition hover:bg-[#4B261B]"
            >
              Retour au profil
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-50 flex flex-1 flex-col items-center px-2 text-center">
          <img
            src={isVerified ? "/ressources/oeil_charme.png" : "/ressources/Alerte_oeil.png"}
            alt=""
            className="mt-2 w-[82%] max-w-[320px]"
          />

          <h1 className={`${playfairDisplay.className} mt-8 w-[600px] max-w-full font-extrabold leading-[1.04] tracking-[-0.03em] text-zinc-950 min-[200px]:text-[38px]`}>
            {isRejected ? "Vérification refusée" : isVerified ? "Vérification validée" : "Vérification KYC"}
          </h1>

          <p className="mt-30 max-w-[290px] text-[17px] leading-[1.25] text-zinc-600">
            {isRejected
              ? "Ton document n'a pas été validé."
              : isVerified
                ? "Merci, ton identité est vérifiée."
                : "Lance la vérification Stripe pour valider ton identité et débloquer les fonctionnalités sécurisées."}
          </p>

          {errorMessage ? <p className="mt-3 text-sm text-[#E44D3E]">{errorMessage}</p> : null}

          <div className="mt-6 w-full">
            {isVerified ? (
              <Link
                href={`/profile?tab=${backTab}`}
                className="mx-auto inline-flex h-12 min-w-[230px] items-center justify-center rounded-full bg-[#5E3023] px-8 text-[17px] font-semibold text-white transition hover:bg-[#4B261B]"
              >
                Retour au profil
              </Link>
            ) : isRejected ? (
              <button
                type="button"
                onClick={() => void startKyc()}
                disabled={!canRetry}
                className="mx-auto inline-flex h-12 min-w-[260px] items-center justify-center rounded-full bg-[#5E3023] px-8 text-[17px] font-semibold text-white transition hover:bg-[#4B261B] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retryLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startKyc()}
                disabled={isStarting || isSyncing}
                className="mx-auto inline-flex h-12 min-w-[260px] items-center justify-center rounded-full bg-[#5E3023] px-8 text-[17px] font-semibold text-white transition hover:bg-[#4B261B] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStarting ? "Redirection..." : isSyncing ? "Synchronisation..." : "Commencer la vérification"}
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
