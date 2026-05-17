"use client";

import { useEffect, useState } from "react";

import {
  BORROW_MS_PER_DAY,
  applyBorrowExtensionDaysToDeadlineMs,
  computeBorrowDeadlineMs,
  formatBorrowLastHoursCountdown,
  type SegnaBorrowMembershipLabel,
} from "@/lib/emprunt/borrow-period";

type EmpruntBorrowCountdownProps = {
  deliveredAtIso: string;
  orderNumberCompact: string;
  membershipLabel: SegnaBorrowMembershipLabel;
  /** Colis retour déposé au relais (`dropped_out` ou statut ultérieur) : plus de rappel « retard ». */
  returnCommitmentMet?: boolean;
  borrowExtensionDaysTotal?: number;
};

function clampRemaining(deadlineMs: number, now: number): number {
  return Math.max(0, deadlineMs - now);
}

function formatDeadlineDdMm(deadlineMs: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  }).format(new Date(deadlineMs));
}

function formatDeadlineLong(deadlineMs: number): string {
  const raw = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date(deadlineMs));
  return raw.replace(/^\p{L}/u, (c) => c.toUpperCase());
}

function elapsedBorrowIntro(membershipLabel: SegnaBorrowMembershipLabel): string {
  if (membershipLabel === "Guest") {
    return "Les 10 jours après livraison sont écoulés";
  }
  return `La période d'emprunt d'un mois après livraison est écoulée`;
}

/**
 * Date limite de retour ; décompte horaire uniquement dans les **dernières 24 h** (aligné sur le bloc « Gère ton panier »).
 */
export function EmpruntBorrowCountdown({
  deliveredAtIso,
  orderNumberCompact,
  membershipLabel,
  returnCommitmentMet,
  borrowExtensionDaysTotal = 0,
}: EmpruntBorrowCountdownProps) {
  const deliveredMs = Date.parse(deliveredAtIso);
  const deadlineMs = applyBorrowExtensionDaysToDeadlineMs(
    computeBorrowDeadlineMs(deliveredMs, membershipLabel),
    borrowExtensionDaysTotal,
  );

  const [now, setNow] = useState(() => Date.now());
  const remainingForTick = Number.isFinite(deadlineMs) ? clampRemaining(deadlineMs, now) : 0;
  const inLast24h = remainingForTick > 0 && remainingForTick <= BORROW_MS_PER_DAY;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), inLast24h ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [inLast24h]);

  const lineClass = "text-[15px] font-normal leading-snug text-zinc-500";

  if (!Number.isFinite(deadlineMs)) {
    return (
      <p className={`mt-4 ${lineClass}`}>
        Commande {orderNumberCompact} — pièces livrées chez toi
      </p>
    );
  }

  const remaining = clampRemaining(deadlineMs, now);
  const ddmm = formatDeadlineDdMm(deadlineMs);
  const longDate = formatDeadlineLong(deadlineMs);

  if (returnCommitmentMet) {
    return (
      <p className={`mt-4 ${lineClass}`}>
        Retour pris en charge au relais — ton engagement sur les délais est réputé respecté · Commande{" "}
        {orderNumberCompact}
      </p>
    );
  }

  return (
    <p className={`mt-4 ${lineClass}`} aria-live={inLast24h ? "off" : "polite"}>
      {remaining <= 0 ? (
        <>
          {elapsedBorrowIntro(membershipLabel)} — date limite de retour : {longDate} ({ddmm}) · Commande{" "}
          {orderNumberCompact}. Pense à organiser ton retour depuis la section ci-dessous lorsque le flux sera
          disponible.
        </>
      ) : remaining <= BORROW_MS_PER_DAY ? (
        <>
          Plus que{" "}
          <span className="tabular-nums">{formatBorrowLastHoursCountdown(remaining)}</span> avant retour ({ddmm}) —
          date limite : {longDate} · Commande {orderNumberCompact}
        </>
      ) : (
        <>
          Date limite de retour : {longDate} ({ddmm}) · Commande {orderNumberCompact}
        </>
      )}
    </p>
  );
}
