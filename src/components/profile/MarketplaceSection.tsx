"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const playfairDisplay = segnaPlayfairDisplay;

import { CardBase } from "@/components/layout/CardBase";

export type MarketplaceMembershipTier = "guest" | "segna_plus" | "segna_x";

export function MarketplaceSection() {
  const [marketplaceModalOpen, setMarketplaceModalOpen] = useState(false);
  const [processingPack, setProcessingPack] = useState<number | null>(null);

  const visibilityLabel = "Obtenir plus";
  const visibilityDescription =
    "Recharge ton solde de crédits pour la location et l’échange (packs Stripe).";
  const modalTitle = "Crédits";
  const modalDescription =
    "Les crédits s’ajoutent à ton solde. Les packs et tarifs correspondent à ton offre Stripe (200, 500 ou 1000 crédits).";
  const unitLabel = "crédit";
  const unitLabelPlural = "crédits";
  /** Libellés alignés sur les produits Stripe (à ajuster si tu changes les prix). */
  const packOptions = [
    { quantity: 200, priceLabel: "9,99€" },
    { quantity: 500, priceLabel: "19,99€" },
    { quantity: 1000, priceLabel: "49,99€" },
  ] as const;

  const handlePackCheckout = async (quantity: number) => {
    if (processingPack !== null) return;
    setProcessingPack(quantity);
    try {
      const response = await fetch("/api/stripe/credits/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pack: quantity,
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
      setProcessingPack(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <section className="space-y-3">
          <button type="button" onClick={() => setMarketplaceModalOpen(true)} className="block w-full text-left">
            <CardBase className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-semibold text-zinc-900">{visibilityLabel}</p>
                <p className="text-sm text-zinc-600">{visibilityDescription}</p>
              </div>
              <ChevronRight className="text-zinc-400" />
            </CardBase>
          </button>
        </section>
      </div>

      {marketplaceModalOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/18 backdrop-blur-[3px]" onClick={() => setMarketplaceModalOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] flex justify-center px-4 md:bottom-[88px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative w-full max-w-[398px] rounded-[22px] bg-white px-5 pb-6 pt-3 text-zinc-950 shadow-[0_12px_34px_rgba(20,10,6,0.22)]">
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setMarketplaceModalOpen(false)}
                className="absolute right-4 top-3 text-[28px] leading-none text-zinc-900"
              >
                ×
              </button>

              <h3 className={`${playfairDisplay.className} mt-4 text-center text-[44px] font-bold leading-[0.95]`}>{modalTitle}</h3>
              <p className="mx-auto mt-3 max-w-[320px] text-center text-[14px] leading-[1.35] text-zinc-700">{modalDescription}</p>

              <div className="mt-6 space-y-3">
                {packOptions.map((pack) => (
                  <button
                    key={`${pack.quantity}-${pack.priceLabel}`}
                    type="button"
                    onClick={() => void handlePackCheckout(pack.quantity)}
                    disabled={processingPack !== null}
                    className="flex h-14 w-full items-center justify-center rounded-full border border-zinc-300 px-4 text-center disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="text-[18px] font-semibold leading-none text-zinc-900">{pack.quantity}</span>
                    <span className="ml-1 text-base font-semibold text-zinc-900">{pack.quantity > 1 ? unitLabelPlural : unitLabel}</span>
                    <span className="ml-2 text-lg text-zinc-500">{pack.priceLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
