"use client";

import { useEffect, useState } from "react";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
/** Durée d’emprunt : 7×24 h à partir du passage en livré (`updated_at`). */
export const EMPRUNT_PERIOD_DAYS = 7;
/** À partir de ce délai restant : message « Plus que … avant retour (jj/mm) ». */
const URGENT_LAST_DAYS_MS = 3 * MS_PER_DAY;

type EmpruntBorrowCountdownProps = {
  deliveredAtIso: string;
  orderNumberCompact: string;
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

/**
 * Date limite de retour (fin des 7 j. après livraison) ; sous 3 j. restants : rappel urgent avec (jj/mm).
 */
export function EmpruntBorrowCountdown({
  deliveredAtIso,
  orderNumberCompact,
  returnCommitmentMet,
}: EmpruntBorrowCountdownProps) {
  const deliveredMs = Date.parse(deliveredAtIso);
  const deadlineMs =
    Number.isFinite(deliveredMs) && deliveredMs > 0
      ? deliveredMs + EMPRUNT_PERIOD_DAYS * MS_PER_DAY
      : NaN;

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
          Les {EMPRUNT_PERIOD_DAYS} jours après livraison sont écoulés — date limite de retour : {longDate} ({ddmm}) ·
          Commande {orderNumberCompact}. Pense à organiser ton retour depuis la section ci-dessous lorsque le flux sera
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
