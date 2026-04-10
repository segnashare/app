"use client";

import Link from "next/link";

export function ContinueToPaymentLink() {
  return (
    <Link
      href="/cart/payment"
      className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition active:bg-zinc-800"
    >
      Continuer vers le paiement
    </Link>
  );
}
