"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

type PackageMode = "plus" | "minus";

const planCards = [
  { badge: "Nouveau", period: "1 semaine", price: "16,99 €/sem", featured: false },
  { badge: "Économise 52 %", period: "1 mois", price: "8,16 €/sem", featured: false },
  { badge: "Économise 68 %", period: "3 mois", price: "5,44 €/sem", featured: true },
  { badge: "Économise 72 %", period: "6 mois", price: "4,08 €/sem", featured: false },
];

/** Espace sous le header fixe (safe area + grille icônes + barres). */
const SCROLL_PADDING_TOP = "calc(env(safe-area-inset-top, 0px) + 5.85rem)";
/** Espace au-dessus du footer fixe (CTA + Annuler + safe area). */
const SCROLL_PADDING_BOTTOM = "calc(env(safe-area-inset-bottom, 0px) + 9.75rem)";

export default function PackagePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<PackageMode>("plus");
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (planParam === "minus" || planParam === "x") {
      setMode("minus");
      return;
    }
    if (planParam === "plus") {
      setMode("plus");
    }
  }, [searchParams]);

  const isMinus = mode === "minus";
  const activePlanCode = mode === "plus" ? "segna_plus" : "segna_x";

  const title = mode === "plus" ? "Ose plus.\nÉchange plus.\nPorte plus." : "Commence simple.\nTeste en douceur.\nÉvolue vite.";
  const cta = mode === "plus" ? "Profite de 3 mois pour 99,99€" : "Commencer avec l'offre légère";

  const handleSubscriptionCheckout = async () => {
    if (isCheckoutLoading) return;
    setIsCheckoutLoading(true);
    try {
      const response = await fetch("/api/stripe/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planCode: activePlanCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message ?? "Impossible de rediriger vers Stripe.");
      }
      window.location.assign(payload.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de lancer le paiement.";
      window.alert(message);
      setIsCheckoutLoading(false);
    }
  };

  return (
    <main className={cn("relative min-h-[100dvh]", isMinus ? "bg-[#1A1A1A]" : "bg-white")}>
      <header
        className={cn(
          "fixed left-0 right-0 top-0 z-50 flex justify-center border-b",
          isMinus ? "border-zinc-700 bg-[#1A1A1A]" : "border-zinc-200 bg-white",
        )}
      >
        <div
          className={cn(
            "w-full max-w-[560px] px-6 pb-4",
            "pt-[max(0.75rem,calc(env(safe-area-inset-top,0px)+0.5rem))]",
          )}
        >
          <div className="grid grid-cols-2 items-center gap-0">
            <button type="button" onClick={() => setMode("plus")} className="flex justify-center">
              <img src="/ressources/icons/segna+.svg" alt="" width={52} height={52} className={cn(isMinus ? "brightness-0 invert" : "")} />
            </button>
            <button type="button" onClick={() => setMode("minus")} className="flex justify-center">
              <img src="/ressources/icons/segnaX.svg" alt="" width={52} height={52} className={cn(isMinus ? "brightness-0 invert" : "")} />
            </button>
            <div className="mt-3">
              <span
                className={cn(
                  "block h-[3px] w-full",
                  mode === "plus" ? (isMinus ? "bg-white opacity-95" : "bg-zinc-900 opacity-90") : isMinus ? "bg-zinc-700" : "bg-zinc-300",
                )}
              />
            </div>
            <div className="mt-3">
              <span
                className={cn(
                  "block h-[3px] w-full",
                  mode === "minus" ? (isMinus ? "bg-white opacity-95" : "bg-zinc-900 opacity-90") : isMinus ? "bg-zinc-700" : "bg-zinc-300",
                )}
              />
            </div>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "mx-auto flex w-full max-w-[560px] flex-col px-6",
          "min-h-[100dvh]",
          "pt-[var(--pkg-pt)] pb-[var(--pkg-pb)]",
        )}
        style={
          {
            "--pkg-pt": SCROLL_PADDING_TOP,
            "--pkg-pb": SCROLL_PADDING_BOTTOM,
          } as CSSProperties
        }
      >
        <section className="mt-7 grid grid-cols-[1fr_172px] items-center gap-4">
          <h1
            className={cn(
              playfairDisplay.className,
              "whitespace-pre-line text-[clamp(38px,4.5vw,50px)] font-extrabold leading-[0.95] tracking-[-0.02em]",
              isMinus ? "text-white" : "text-zinc-950",
            )}
          >
            {title}
          </h1>
          <div
            className={cn(
              "h-[clamp(180px,22vw,224px)] w-[clamp(180px,16vw,172px)] overflow-hidden rounded-none",
              isMinus ? "bg-[#1A1A1A]" : "bg-zinc-100",
            )}
          >
            <img
              src="/ressources/girl_package.png"
              alt=""
              className={cn("aspect-square h-full w-full object-cover object-center", isMinus ? "grayscale" : "")}
            />
          </div>
        </section>

        <section className="mt-10">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {planCards.map((card) => (
              <article
                key={`${card.badge}-${card.period}`}
                className={cn(
                  "aspect-square w-[132px] shrink-0 overflow-hidden rounded-[20px] border-2",
                  card.featured
                    ? isMinus
                      ? "border-white shadow-[0_0_0_1px_white]"
                      : "border-zinc-900 shadow-[0_0_0_1px_rgb(24_24_27)]"
                    : isMinus
                      ? "border-zinc-700"
                      : "border-zinc-300",
                )}
              >
                <div
                  className={cn(
                    montserrat.className,
                    "flex h-[38px] items-center justify-center px-2 text-center text-[13px] font-semibold leading-none",
                    card.featured
                      ? isMinus
                        ? "bg-white text-zinc-950"
                        : "bg-zinc-900 text-white"
                      : isMinus
                        ? "bg-[#1A1A1A] text-white"
                        : "bg-zinc-100 text-zinc-900",
                  )}
                >
                  {card.badge}
                </div>
                <div
                  className={cn(
                    "flex h-[calc(100%-38px)] flex-col items-center justify-center bg-transparent px-2 text-center",
                    isMinus ? "text-white" : "text-zinc-900",
                  )}
                >
                  <p className={cn(montserrat.className, "text-[clamp(16px,1.5vw,18px)] font-medium leading-[1.05]")}>{card.period}</p>
                  <p className={cn(montserrat.className, "mt-2 text-[clamp(14px,1.5vw,16px)] font-bold leading-[1.05]")}>{card.price}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-3 md:mt-14 md:space-y-5">
          <article>
            <h2
              className={cn(
                montserrat.className,
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]",
                isMinus ? "text-white" : "text-zinc-950",
              )}
            >
              Plus de pièces
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]",
                isMinus ? "text-zinc-200" : "text-zinc-600",
              )}
            >
              Emprunte 5 pièces par mois avec une valeur allant jusqu&apos;à 1000€
            </p>
          </article>
          <div className={cn("h-px w-full", isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          <article className={mode === "plus" ? "" : "opacity-45"}>
            <h2
              className={cn(
                montserrat.className,
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]",
                isMinus ? "text-white" : "text-zinc-950",
              )}
            >
              Plus de style
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]",
                isMinus ? "text-zinc-200" : "text-zinc-600",
              )}
            >
              Emprunte pour 1000€ de pièces tous les mois
            </p>
          </article>
          <div className={cn("h-px w-full", isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          <article className={mode === "plus" ? "" : "opacity-45"}>
            <h2
              className={cn(
                montserrat.className,
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]",
                isMinus ? "text-white" : "text-zinc-950",
              )}
            >
              xxxx
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]",
                isMinus ? "text-zinc-200" : "text-zinc-600",
              )}
            >
              Emprunte pour xxxx de pièces tous les mois
            </p>
          </article>
        </section>

        <p
          className={cn(
            montserrat.className,
            "mt-8 text-center text-[13px] leading-[1.12]",
            isMinus ? "text-zinc-100" : "text-zinc-950",
          )}
        >
          * La capacité d&apos;emprunt (jusqu&apos;à 5 pièces et 1 000 € de valeur) est accessible sous réserve de mise à disposition
          d&apos;un montant équivalent en pièces prêtées sur la plateforme. Ton paiement sera débité à la confirmation de l&apos;abonnement
          et celui-ci sera renouvelé automatiquement pour la même durée et au même tarif, sauf annulation depuis les paramètres de ton compte
          avant la date de renouvellement. En souscrivant, tu confirmes accepter nos Conditions générales.
        </p>
      </div>

      <footer
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 flex justify-center border-t",
          isMinus ? "border-zinc-700 bg-[#1A1A1A]" : "border-zinc-200 bg-white",
        )}
      >
        <div className="w-full max-w-[560px] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
          <button
            type="button"
            onClick={handleSubscriptionCheckout}
            disabled={isCheckoutLoading}
            className={cn(
              montserrat.className,
              "inline-flex h-[58px] w-full items-center justify-center rounded-full text-[16px] font-semibold disabled:cursor-not-allowed disabled:opacity-70",
              isMinus ? "bg-white text-zinc-950" : "bg-zinc-950 text-white",
            )}
          >
            {isCheckoutLoading ? "Redirection..." : cta}
          </button>
          <button
            type="button"
            onClick={() => router.push("/exchange")}
            className={cn(
              montserrat.className,
              "mt-3 inline-flex h-8 w-full items-center justify-center bg-transparent text-[15px] font-semibold underline underline-offset-4",
              isMinus ? "text-white" : "text-zinc-900",
            )}
          >
            Annuler
          </button>
        </div>
      </footer>
    </main>
  );
}
