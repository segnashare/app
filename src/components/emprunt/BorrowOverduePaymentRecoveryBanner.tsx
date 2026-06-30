"use client";

import Link from "next/link";

import type { MemberBorrowOverdueAppGate } from "@/lib/emprunt/fetch-member-borrow-overdue-app-gate";
import { cn } from "@/lib/utils/cn";

type Props = {
  gate: MemberBorrowOverdueAppGate | null;
};

export function BorrowOverduePaymentRecoveryBanner({ gate }: Props) {
  if (!gate?.showPaymentRecoveryBanner) return null;

  const requiresSca = gate.recoveryStatus === "requires_action";

  return (
    <div
      className={cn(
        "border-b px-4 py-3 text-center text-xs font-medium leading-snug",
        requiresSca
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-orange-300 bg-orange-50 text-orange-950",
      )}
      role="status"
    >
      {requiresSca
        ? "Ton banque demande une validation pour les frais de retard."
        : "Le prélèvement des frais de retard a échoué."}{" "}
      <Link href={gate.regulariserHref} className="font-semibold underline underline-offset-2">
        Régulariser maintenant
      </Link>
    </div>
  );
}
