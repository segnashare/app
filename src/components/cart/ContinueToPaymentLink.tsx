"use client";

import Link from "next/link";

export function ContinueToPaymentLink() {
  return (
    <Link
      href="/cart/payment"
      className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[15px] font-bold text-white shadow-sm"
    >
      Continuer vers le paiement
    </Link>
  );
}
