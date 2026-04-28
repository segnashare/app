"use client";

import { useEffect, useState } from "react";

import { computeBorrowDeadlineMs, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
/** À partir de ce délai restant : message « Plus que … avant retour (jj/mm) ». */
const URGENT_LAST_DAYS_MS = 3 * MS_PER_DAY;

type EmpruntBorrowCountdownProps = {
  deliveredAtIso: string;
  orderNumberCompact: string;
  membershipLabel: SegnaBorrowMembershipLabel;
  /** Colis retour déposé au relais (`dropped_out` ou statut ultérieur) : plus de rappel « retard ». */
  returnCommitmentMet?: boolean;
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

/** Texte « Plus que X » (j., h, min). */
function formatPlusQueDuration(remaining: number): string {
  const d = Math.floor(remaining / MS_PER_DAY);
  const h = Math.floor((remaining % MS_PER_DAY) / MS_PER_HOUR);
  const m = Math.floor((remaining % MS_PER_HOUR) / MS_PER_MINUTE);
  if (d >= 1) {
    return h > 0 ? `${d} j. ${h} h` : `${d} j.`;
  }
  if (h >= 1) {
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  return `${m} min`;
}

function elapsedBorrowIntro(membershipLabel: SegnaBorrowMembershipLabel): string {
  if (membershipLabel === "Guest") {
    return "Les 10 jours après livraison sont écoulés";
  }
  return `La période d'emprunt d'un mois après livraison est écoulée`;
}

/**
 * Date limite de retour (10 j. pour non-abonnés, +1 mois calendaire pour abonnés depuis livré) ; sous 3 j. restants : urgent.
 */
export function EmpruntBorrowCountdown({
  deliveredAtIso,
  orderNumberCompact,
  membershipLabel,
  returnCommitmentMet,
}: EmpruntBorrowCountdownProps) {
  const deliveredMs = Date.parse(deliveredAtIso);
  const deadlineMs = computeBorrowDeadlineMs(deliveredMs, membershipLabel);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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

  const urgent = remaining > 0 && remaining <= URGENT_LAST_DAYS_MS;

  if (returnCommitmentMet) {
    return (
      <p className={`mt-4 ${lineClass}`}>
        Retour pris en charge au relais — ton engagement sur les délais est réputé respecté · Commande{" "}
        {orderNumberCompact}
      </p>
    );
  }

  return (
    <p className={`mt-4 ${lineClass}`} aria-live={urgent ? "polite" : undefined}>
      {remaining <= 0 ? (
        <>
          {elapsedBorrowIntro(membershipLabel)} — date limite de retour : {longDate} ({ddmm}) · Commande{" "}
          {orderNumberCompact}. Pense à organiser ton retour depuis la section ci-dessous lorsque le flux sera
          disponible.
        </>
      ) : remaining <= URGENT_LAST_DAYS_MS ? (
        <>
          Plus que {formatPlusQueDuration(remaining)} avant retour ({ddmm}) — date limite : {longDate} · Commande{" "}
          {orderNumberCompact}
        </>
      ) : (
        <>
          Date limite de retour : {longDate} ({ddmm}) · Commande {orderNumberCompact}
        </>
      )}
    </p>
  );
}
