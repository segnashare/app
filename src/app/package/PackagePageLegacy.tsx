"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

const planCards = [
  { badge: "Nouveau", period: "1 semaine", price: "16,99 €/sem", featured: false },
  { badge: "Économise 52 %", period: "1 mois", price: "8,16 €/sem", featured: false },
  { badge: "Économise 68 %", period: "3 mois", price: "5,44 €/sem", featured: true },
  { badge: "Économise 72 %", period: "6 mois", price: "4,08 €/sem", featured: false },
];

const SCROLL_PADDING_TOP = "calc(env(safe-area-inset-top, 0px) + 4.35rem)";
const SCROLL_PADDING_BOTTOM = "calc(env(safe-area-inset-bottom, 0px) + 9.75rem)";

export default function PackagePageLegacy() {
  const router = useRouter();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const title = "Ose plus.\nÉchange plus.\nPorte plus.";
  const cta = "Profite de 3 mois pour 99,99€";

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
          planCode: "segna_plus",
          cancelReturnPath: "/package?checkout=cancelled",
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
    <main className="relative min-h-[100dvh] bg-white">
      <header className="fixed left-0 right-0 top-0 z-50 flex justify-center border-b border-zinc-200 bg-white">
        <div
          className={cn(
            "w-full max-w-[560px] px-6 pb-3",
            "pt-[max(0.75rem,calc(env(safe-area-inset-top,0px)+0.5rem))]",
          )}
        >
          <div className="flex justify-center py-1">
            <img src="/ressources/icons/segna+.svg" alt="Segna+" width={52} height={52} />
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
              "whitespace-pre-line text-[clamp(38px,4.5vw,50px)] font-extrabold leading-[0.95] tracking-[-0.02em] text-zinc-950",
            )}
          >
            {title}
          </h1>
          <div className="h-[clamp(180px,22vw,224px)] w-[clamp(180px,16vw,172px)] overflow-hidden rounded-none bg-zinc-100">
            <img
              src="/ressources/girl_package.png"
              alt=""
              className="aspect-square h-full w-full object-cover object-center"
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
                    ? "border-zinc-900 shadow-[0_0_0_1px_rgb(24_24_27)]"
                    : "border-zinc-300",
                )}
              >
                <div
                  className={cn(
                    montserrat.className,
                    "flex h-[38px] items-center justify-center px-2 text-center text-[13px] font-semibold leading-none",
                    card.featured ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900",
                  )}
                >
                  {card.badge}
                </div>
                <div className="flex h-[calc(100%-38px)] flex-col items-center justify-center bg-transparent px-2 text-center text-zinc-900">
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
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] text-zinc-950 md:text-[28px]",
              )}
            >
              Plus de pièces
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] text-zinc-600 md:text-[20px] md:leading-[1.12]",
              )}
            >
              Emprunte 5 pièces par mois avec une valeur allant jusqu&apos;à 1000€
            </p>
          </article>
          <div className="h-px w-full bg-zinc-300" />
          <article>
            <h2
              className={cn(
                montserrat.className,
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] text-zinc-950 md:text-[28px]",
              )}
            >
              Plus de style
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] text-zinc-600 md:text-[20px] md:leading-[1.12]",
              )}
            >
              Emprunte pour 1000€ de pièces tous les mois
            </p>
          </article>
          <div className="h-px w-full bg-zinc-300" />
          <article>
            <h2
              className={cn(
                montserrat.className,
                "text-[22px] font-semibold leading-[1.02] tracking-[-0.02em] text-zinc-950 md:text-[28px]",
              )}
            >
              xxxx
            </h2>
            <p
              className={cn(
                montserrat.className,
                "text-[14px] leading-[1.08] text-zinc-600 md:text-[20px] md:leading-[1.12]",
              )}
            >
              Emprunte pour xxxx de pièces tous les mois
            </p>
          </article>
        </section>

        <p
          className={cn(
            montserrat.className,
            "mt-8 text-center text-[13px] leading-[1.12] text-zinc-950",
          )}
        >
          * La capacité d&apos;emprunt (jusqu&apos;à 5 pièces et 1 000 € de valeur) est accessible sous réserve de mise à disposition
          d&apos;un montant équivalent en pièces prêtées sur la plateforme. Ton paiement sera débité à la confirmation de l&apos;abonnement
          et celui-ci sera renouvelé automatiquement pour la même durée et au même tarif, sauf annulation depuis les paramètres de ton compte
          avant la date de renouvellement. En souscrivant, tu confirmes accepter nos Conditions générales.
        </p>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-50 flex justify-center border-t border-zinc-200 bg-white">
        <div className="w-full max-w-[560px] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
          <button
            type="button"
            onClick={() => void handleSubscriptionCheckout()}
            disabled={isCheckoutLoading}
            className={cn(
              montserrat.className,
              "inline-flex h-[58px] w-full items-center justify-center rounded-full bg-zinc-950 text-[16px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70",
            )}
          >
            {isCheckoutLoading ? "Redirection..." : cta}
          </button>
          <button
            type="button"
            onClick={() => router.push("/exchange")}
            className={cn(
              montserrat.className,
              "mt-3 inline-flex h-8 w-full items-center justify-center bg-transparent text-[15px] font-semibold text-zinc-900 underline underline-offset-4",
            )}
          >
            Annuler
          </button>
        </div>
      </footer>
    </main>
  );
}
