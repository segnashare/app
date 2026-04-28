import { SEGNA_OUTBOUND_PREP_ESTIMATE_MINUTES } from "@/lib/uber-direct/segna-prep-estimate";

const ISO_TRY = /^\d{4}-\d{2}-\d{2}T/;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** `fee` brut Uber (`delivery_quotes`) en centimes, ou null si absent / invalide. */
export function uberQuoteFeeCentsFromRaw(quote: Record<string, unknown>): number | null {
  const fee = asFiniteNumber(quote.fee);
  if (fee == null || fee < 0 || !Number.isFinite(fee)) return null;
  return Math.round(fee);
}

/** Uber indique en général `fee` en plus petite unité monétaire (ex. centimes). */
export function formatUberQuoteFee(v: unknown, currencyHint: unknown): string | null {
  const fee = asFiniteNumber(v);
  if (fee == null) return null;
  const cur =
    typeof currencyHint === "string" && /^[A-Z]{3}$/i.test(currencyHint.trim())
      ? currencyHint.trim().toUpperCase()
      : "EUR";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur }).format(fee / 100);
  } catch {
    return `${(fee / 100).toFixed(2)} ${cur}`;
  }
}

export function formatUberMaybeDateFr(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (!ISO_TRY.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export function formatUberDurationMinutes(v: unknown): string | null {
  const n = asFiniteNumber(v);
  if (n == null || n < 0) return null;
  return `${Math.round(n)} min`;
}

const RANGE_SPAN_MINUTES = 30;

function formatClockFr(d: Date): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Plage horaire fixe de 30 min pour l’arrivée estimée : le début est
 * `baseTime` + préparation interne (30 min) + durée trajet Uber, la fin = début + 30 min.
 */
export function buildUberMemberArrivalLineFr(
  quote: Record<string, unknown> | null | undefined,
  baseTimeMs: number,
): string | null {
  if (!quote) return null;
  const tripMin = asFiniteNumber(quote.duration);
  if (tripMin == null || !Number.isFinite(tripMin) || tripMin < 0) return null;
  const addMs = (SEGNA_OUTBOUND_PREP_ESTIMATE_MINUTES + tripMin) * 60_000;
  const rangeStart = new Date(baseTimeMs + addMs);
  const rangeEnd = new Date(rangeStart.getTime() + RANGE_SPAN_MINUTES * 60_000);
  return `${formatClockFr(rangeStart)} – ${formatClockFr(rangeEnd)}`;
}

/** Libellés FR pour les clés courantes de la quote Uber. */
export const UBER_QUOTE_FIELD_LABELS_FR: Record<string, string> = {
  kind: "Type",
  id: "Identifiant devis",
  created: "Créé le",
  expires: "Expire le",
  fee: "Tarif (unités mineures, brut API)",
  currency: "Devise",
  currency_type: "Type devise",
  dropoff_eta: "ETA livraison",
  pickup_eta: "ETA enlèvement",
  duration: "Durée totale (min)",
  pickup_duration: "Durée enlèvement (min)",
  dropoff_deadline: "Échéance livraison",
  pickup_deadline: "Échéance enlèvement",
  pickup_duration_estimate: "Estimation enlèvement (min)",
};
