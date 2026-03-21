"use client";

import { Montserrat, Playfair_Display } from "next/font/google";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});
const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

type PackageMode = "plus" | "minus";

const planCards = [
  { badge: "Nouveau", period: "1 semaine", price: "16,99 €/sem", featured: false },
  { badge: "Économise 52 %", period: "1 mois", price: "8,16 €/sem", featured: false },
  { badge: "Économise 68 %", period: "3 mois", price: "5,44 €/sem", featured: true },
  { badge: "Économise 72 %", period: "6 mois", price: "4,08 €/sem", featured: false },
];

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
    <main className={cn("flex min-h-[100dvh] justify-center", isMinus ? "bg-[#1A1A1A]" : "bg-white")}>
      <div className="flex min-h-[844px] w-full max-w-[560px] flex-col px-6 pb-8 pt-8">
        <section className="-mx-6 grid grid-cols-2 items-center gap-0 pb-4">
          <button type="button" onClick={() => setMode("plus")} className="flex justify-center">
            <img src="/ressources/icons/segna+.svg" alt="" width={52} height={52} className={cn(isMinus ? "brightness-0 invert" : "")} />
          </button>
          <button type="button" onClick={() => setMode("minus")} className="flex justify-center">
            <img src="/ressources/icons/segnaX.svg" alt="" width={52} height={52} className={cn(isMinus ? "brightness-0 invert" : "")} />
          </button>
          <div className="mt-3">
            <span className={cn("block h-[3px] w-full ", mode === "plus" ? (isMinus ? "bg-white opacity-95" : "bg-zinc-900 opacity-90") : isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          </div>
          <div className="mt-3">
            <span className={cn("block h-[3px] w-full", mode === "minus" ? (isMinus ? "bg-white opacity-95" : "bg-zinc-900 opacity-90") : isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          </div>
        </section>

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
          <div className={cn("h-[clamp(180px,22vw,224px)] w-[clamp(180px,16vw,172px)] overflow-hidden rounded-none", isMinus ? "bg-[#1A1A1A]" : "bg-zinc-100")}>
            <img
              src="/ressources/girl_package.png"
              alt=""
              className={cn("h-full w-full object-cover object-center aspect-square", isMinus ? "grayscale" : "")}
            />
          </div>
        </section>

        <section className="mt-10">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {planCards.map((card) => (
              <article
                key={`${card.badge}-${card.period}`}
                className={cn(
                  "shrink-0 w-[132px] aspect-square overflow-hidden rounded-[20px] border-2",
                  card.featured ? (isMinus ? "border-white shadow-[0_0_0_1px_white]" : "border-[#5E3023] shadow-[0_0_0_1px_#5E3023]") : isMinus ? "border-zinc-700" : "border-zinc-300",
                )}
              >
                <div
                  className={cn(
                    montserrat.className,
                    "flex h-[38px] items-center justify-center px-2 text-center text-[13px] font-semibold leading-none",
                    card.featured ? (isMinus ? "bg-white text-zinc-950" : "bg-[#5E3023] text-white") : isMinus ? "bg-[#1A1A1A] text-white" : "bg-zinc-100 text-zinc-900",
                  )}
                >
                  {card.badge}
                </div>
                <div className={cn("flex h-[calc(100%-38px)] flex-col items-center justify-center bg-transparent px-2 text-center", isMinus ? "text-white" : "text-zinc-900")}>
                  <p className={cn(montserrat.className, "text-[clamp(16px,1.5vw,18px)] font-medium leading-[1.05]")}>{card.period}</p>
                  <p className={cn(montserrat.className, "mt-2 text-[clamp(14px,1.5vw,16px)] font-bold leading-[1.05]")}>{card.price}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-3 md:mt-14 md:space-y-5">
          <article>
            <h2 className={cn(montserrat.className, "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]", isMinus ? "text-white" : "text-zinc-950")}>Plus de pièces</h2>
            <p className={cn(montserrat.className, "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]", isMinus ? "text-zinc-200" : "text-zinc-600")}>Emprunte 5 pièces par mois avec une valeur allant jusqu&apos;à 1000€</p>
          </article>
          <div className={cn("h-px w-full", isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          <article className={mode === "plus" ? "" : "opacity-45"}>
            <h2 className={cn(montserrat.className, "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]", isMinus ? "text-white" : "text-zinc-950")}>Plus de style</h2>
            <p className={cn(montserrat.className, "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]", isMinus ? "text-zinc-200" : "text-zinc-600")}>Emprunte pour 1000€ de pièces tous les mois</p>
          </article>
          <div className={cn("h-px w-full", isMinus ? "bg-zinc-700" : "bg-zinc-300")} />
          <article className={mode === "plus" ? "" : "opacity-45"}>
            <h2 className={cn(montserrat.className, "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] md:text-[28px]", isMinus ? "text-white" : "text-zinc-950")}>xxxx</h2>
            <p className={cn(montserrat.className, "text-[14px] leading-[1.08] md:text-[20px] md:leading-[1.12]", isMinus ? "text-zinc-200" : "text-zinc-600")}>Emprunte pour xxxx de pièces tous les mois</p>
          </article>
        </section>

        <p className={cn(montserrat.className, "mt-8 text-center text-[13px] leading-[1.12]", isMinus ? "text-zinc-100" : "text-zinc-950")}>
          * La capacité d&apos;emprunt (jusqu&apos;à 5 pièces et 1 000 € de valeur) est accessible sous réserve de mise à disposition
          d&apos;un montant équivalent en pièces prêtées sur la plateforme. Ton paiement sera débité à la confirmation de l&apos;abonnement
          et celui-ci sera renouvelé automatiquement pour la même durée et au même tarif, sauf annulation depuis les paramètres de ton compte
          avant la date de renouvellement. En souscrivant, tu confirmes accepter nos Conditions générales.
        </p>

        <section className="mt-auto pt-5">
          <button
            type="button"
            onClick={handleSubscriptionCheckout}
            disabled={isCheckoutLoading}
            className={cn(
              montserrat.className,
              "inline-flex h-[58px] w-full items-center justify-center rounded-full text-[16px] font-semibold disabled:cursor-not-allowed disabled:opacity-70",
              isMinus ? "bg-white text-zinc-950" : "bg-gradient-to-b from-[#5E3023] to-[#895737] text-white",
              )}
          >
            {isCheckoutLoading ? "Redirection..." : cta}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className={cn(
              montserrat.className,
              "mt-3 inline-flex h-8 w-full items-center justify-center bg-transparent text-[15px] font-semibold underline underline-offset-4",
              isMinus ? "text-white" : "text-[#5E3023]",
            )}
          >
            Annuler
          </button>
        </section>
      </div>
    </main>
  );
}
