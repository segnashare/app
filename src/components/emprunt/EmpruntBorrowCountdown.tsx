"use client";

import { useEffect, useState } from "react";

import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";
import { isBorrowReturnAlertPhaseParis } from "@/lib/cart/borrow-return-calendar";

type EmpruntBorrowCountdownProps = {
  returnDueMs: number;
  returnCommitmentMet?: boolean;
};

export function EmpruntBorrowCountdown({
  returnDueMs,
  returnCommitmentMet,
}: EmpruntBorrowCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const lineClass = "mt-4 text-[15px] font-normal leading-snug text-zinc-500";

  if (!Number.isFinite(returnDueMs)) {
    return <p className={lineClass}>Pièces livrées chez toi</p>;
  }

  const dueDateLabel = formatBorrowReturnDueDateFr(returnDueMs);
  const alertPhase = isBorrowReturnAlertPhaseParis(now, returnDueMs);

  if (returnCommitmentMet) {
    return (
      <p className={lineClass}>
        Retour pris en charge au relais — ton engagement sur les délais est réputé respecté
      </p>
    );
  }

  if (alertPhase) {
    return (
      <p className={lineClass}>
        Renvoie ta box le {dueDateLabel} ou prolonge ton échange
      </p>
    );
  }

  return <p className={lineClass}>À retourner avant le {dueDateLabel}</p>;
}
