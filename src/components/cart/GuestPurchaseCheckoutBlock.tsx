"use client";

import { Clock, ShieldCheck } from "lucide-react";

import {
  computeGuestCartPurchaseEuroCents,
  computeMemberCartPurchaseEuroCents,
} from "@/lib/billing/guest-rental-pricing";
import { cn } from "@/lib/utils/cn";

type GuestPurchaseCheckoutBlockProps = {
  cartTotalPoints: number;
  className?: string;
  /** Réduction membre (0–100). Absente / 0 = prix plein. */
  purchaseDiscountPercent?: number;
};

function eurosFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function GuestPurchaseCheckoutBlock({
  cartTotalPoints,
  className,
  purchaseDiscountPercent = 0,
}: GuestPurchaseCheckoutBlockProps) {
  const retailEuroCents = computeGuestCartPurchaseEuroCents(cartTotalPoints);
  const purchaseEuroCents =
    purchaseDiscountPercent > 0
      ? computeMemberCartPurchaseEuroCents(cartTotalPoints, purchaseDiscountPercent)
      : retailEuroCents;
  const showDiscount = purchaseDiscountPercent > 0 && purchaseEuroCents < retailEuroCents;

  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-4 leading-snug">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-zinc-950">Prix d&apos;achat</p>
          {showDiscount ? (
            <p className="mt-1 text-[13px] text-zinc-500">
              <span className="font-bold text-zinc-900">−{purchaseDiscountPercent}%</span> avec ton
              abonnement SegnaX
            </p>
          ) : null}
        </div>
        <div className="inline-flex flex-col items-end gap-0.5">
          {showDiscount ? (
            <span className="text-[13px] font-medium tabular-nums text-zinc-400 line-through">
              {eurosFromCents(retailEuroCents)}
            </span>
          ) : null}
          <span className="text-[15px] font-bold tabular-nums text-zinc-950">
            {eurosFromCents(purchaseEuroCents)}
          </span>
        </div>
      </div>

      <ul className="space-y-1.5" aria-label="Garanties achat">
        <li className="flex items-center gap-2 text-[13px] font-medium text-zinc-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-sky-600" strokeWidth={2.2} aria-hidden />
          Certifié authentique
        </li>
        <li className="flex items-center gap-2 text-[13px] font-medium text-zinc-900">
          <Clock className="h-4 w-4 shrink-0 text-sky-600" strokeWidth={2.2} aria-hidden />
          Une seule pièce disponible
        </li>
      </ul>
    </div>
  );
}
