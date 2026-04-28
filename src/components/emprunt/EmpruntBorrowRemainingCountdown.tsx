"use client";

import { useEffect, useState } from "react";

import { BORROW_PERIOD_DAYS_GUEST, computeBorrowDeadlineMs, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const MS_PER_DAY = 86_400_000;
/** Gris corps (réf. maquette ~#555). */
const BODY_GRAY = "text-[#555555]";

type EmpruntBorrowRemainingCountdownProps = {
  deliveredAtIso: string;
  returnCommitmentMet?: boolean;
  membershipLabel: SegnaBorrowMembershipLabel;
};

function clampRemaining(deadlineMs: number, now: number): number {
  return Math.max(0, deadlineMs - now);
}

function fullDaysRemaining(remainingMs: number): number {
  return Math.floor(remainingMs / MS_PER_DAY);
}

function borrowIntroCopy(membershipLabel: SegnaBorrowMembershipLabel): string {
  if (membershipLabel === "Guest") {
    return `Emprunt de ${BORROW_PERIOD_DAYS_GUEST} jours à partir de la livraison.`;
  }
  return `Emprunt d'un mois à partir de la livraison.`;
}

/** Décompte en jours entiers uniquement. */
export function EmpruntBorrowRemainingCountdown({
  deliveredAtIso,
  returnCommitmentMet,
  membershipLabel,
}: EmpruntBorrowRemainingCountdownProps) {
  const deliveredMs = Date.parse(deliveredAtIso);
  const deadlineMs = computeBorrowDeadlineMs(deliveredMs, membershipLabel);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const body = cn(
    segnaMontserrat.className,
    "text-center text-[16px] font-normal leading-snug sm:text-[17px] sm:leading-relaxed",
    BODY_GRAY,
  );

  if (!Number.isFinite(deadlineMs)) {
    return <p className={body}>{borrowIntroCopy(membershipLabel)}</p>;
  }

  if (returnCommitmentMet) {
    return (
      <p className={body}>
        Retour enregistré au relais —{" "}
        <span className="font-bold text-black">engagement sur les délais respecté</span>.
      </p>
    );
  }

  const remaining = clampRemaining(deadlineMs, now);
  const days = fullDaysRemaining(remaining);

  const elapsedLabel =
    membershipLabel === "Guest"
      ? `Les ${BORROW_PERIOD_DAYS_GUEST} jours d'emprunt sont écoulés`
      : `La période d'emprunt d'un mois est écoulée`;

  return (
    <div aria-live="polite">
      {remaining <= 0 ? (
        <p className={body}>
          {elapsedLabel} — pense à{" "}
          <span className="font-bold text-black">retourner ton panier</span> ci-dessous.
        </p>
      ) : days >= 1 ? (
        <p className={body}>
          Il te reste <span className="font-bold text-black">{days}&nbsp;jour{days > 1 ? "s" : ""}</span>{" "}
          d&apos;emprunt.
        </p>
      ) : (
        <p className={body}>
          Il te reste <span className="font-bold text-black">moins d&apos;un jour</span> d&apos;emprunt.
        </p>
      )}
    </div>
  );
}
