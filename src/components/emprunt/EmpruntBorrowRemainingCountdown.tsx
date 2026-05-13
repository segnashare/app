"use client";

import { useEffect, useState } from "react";

import {
  BORROW_MS_PER_DAY,
  BORROW_PERIOD_DAYS_GUEST,
  borrowRemainingDaysDisplayed,
  computeBorrowDeadlineMs,
  formatBorrowLastHoursCountdown,
  type SegnaBorrowMembershipLabel,
} from "@/lib/emprunt/borrow-period";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

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

function borrowIntroCopy(membershipLabel: SegnaBorrowMembershipLabel): string {
  if (membershipLabel === "Guest") {
    return `Emprunt de ${BORROW_PERIOD_DAYS_GUEST} jours à partir de la livraison.`;
  }
  return `Emprunt d'un mois à partir de la livraison.`;
}

/** Décompte : jours au plafond tant qu’il reste > 24 h ; compteur h/min/s le jour J. */
export function EmpruntBorrowRemainingCountdown({
  deliveredAtIso,
  returnCommitmentMet,
  membershipLabel,
}: EmpruntBorrowRemainingCountdownProps) {
  const deliveredMs = Date.parse(deliveredAtIso);
  const deadlineMs = computeBorrowDeadlineMs(deliveredMs, membershipLabel);

  const [now, setNow] = useState(() => Date.now());
  const remainingForTick = Number.isFinite(deadlineMs)
    ? clampRemaining(deadlineMs, now)
    : 0;
  const useFastTick = remainingForTick > 0 && remainingForTick <= BORROW_MS_PER_DAY;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), useFastTick ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [useFastTick]);

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
  const days = borrowRemainingDaysDisplayed(remaining);

  const elapsedLabel =
    membershipLabel === "Guest"
      ? `Les ${BORROW_PERIOD_DAYS_GUEST} jours d'emprunt sont écoulés`
      : `La période d'emprunt d'un mois est écoulée`;

  const lastDayCountdown = formatBorrowLastHoursCountdown(remaining);

  return (
    <div aria-live={useFastTick ? "off" : "polite"}>
      {remaining <= 0 ? (
        <p className={body}>
          {elapsedLabel} — pense à{" "}
          <span className="font-bold text-black">retourner ton panier</span> ci-dessous.
        </p>
      ) : remaining <= BORROW_MS_PER_DAY ? (
        <p className={body}>
          Fin de l&apos;emprunt dans{" "}
          <span className="font-bold text-black tabular-nums">{lastDayCountdown}</span>.
        </p>
      ) : (
        <p className={body}>
          Il te reste <span className="font-bold text-black">{days}&nbsp;jour{days > 1 ? "s" : ""}</span>{" "}
          d&apos;emprunt.
        </p>
      )}
    </div>
  );
}
