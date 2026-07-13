"use client";

import { Clock, ShieldCheck } from "lucide-react";

import { computeGuestCartPurchaseEuroCents } from "@/lib/billing/guest-rental-pricing";
import { cn } from "@/lib/utils/cn";

type GuestPurchaseCheckoutBlockProps = {
  cartTotalPoints: number;
  className?: string;
};

function eurosFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function GuestPurchaseCheckoutBlock({ cartTotalPoints, className }: GuestPurchaseCheckoutBlockProps) {
  const purchaseEuroCents = computeGuestCartPurchaseEuroCents(cartTotalPoints);

  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4 leading-snug">
        <span className="text-[15px] font-bold text-zinc-950">Prix d&apos;achat</span>
        <span className="text-[15px] font-bold tabular-nums text-zinc-950">{eurosFromCents(purchaseEuroCents)}</span>
      </div>

      <ul className="space-y-1.5" aria-label="Garanties achat">
        <li className="flex items-center gap-2 text-[13px] font-medium text-zinc-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.2} aria-hidden />
          Certifié authentique
        </li>
        <li className="flex items-center gap-2 text-[13px] font-medium text-zinc-900">
          <Clock className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.2} aria-hidden />
          Une seule pièce disponible
        </li>
      </ul>
    </div>
  );
}
