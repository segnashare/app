import { CART_CHECKOUT_VAT_RATE, htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";

/** Libellés prix / délai pour les options Dynamic Checkout (checkout membre). */

type RawLeadTimeHours = {
  p50?: number;
  p60?: number;
  p70?: number;
  p80?: number;
  p90?: number;
  p95?: number;
};

type RawDeliveryDate = {
  delivery_date?: string;
};

export type SendcloudDeliveryEta = {
  minDays: number | null;
  maxDays: number | null;
  label: string | null;
};

/** `shipping_rate.value` Dynamic Checkout = tarif transporteur HT (€), saisi dans le panel Sendcloud. */
export function parseSendcloudShippingRateCents(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value >= 100 ? Math.round(value) : Math.round(value * 100);
  }
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const n = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** HT panel Sendcloud → TTC membre (TVA 20 % sur les frais de livraison). */
export function sendcloudShippingRateTtcCentsFromHt(htCents: number): number {
  return htToVatAndTtcCents(htCents).ttcCents;
}

/** Uniquement si la source est déjà en TTC (pas les tarifs panel Sendcloud). */
export function sendcloudShippingRateHtCentsFromTtc(ttcCents: number): number {
  return Math.round(ttcCents / (1 + CART_CHECKOUT_VAT_RATE));
}

function pluralJours(n: number): string {
  return n > 1 ? `${n} jours ouvrés` : "1 jour ouvré";
}

export function deliveryEtaFromSendcloudRaw(params: {
  deliveryMethodType?: string;
  leadTimeHours?: RawLeadTimeHours | null;
  deliveryDates?: RawDeliveryDate[] | null;
}): SendcloudDeliveryEta {
  const dates = params.deliveryDates;
  if (Array.isArray(dates) && dates.length > 0) {
    const first = dates[0]?.delivery_date;
    if (first) {
      const delivery = new Date(first);
      if (!Number.isNaN(delivery.getTime())) {
        const now = new Date();
        const diffMs = delivery.getTime() - now.getTime();
        const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
        return { minDays: days, maxDays: days, label: pluralJours(days) };
      }
    }
  }

  const lt = params.leadTimeHours;
  if (lt && typeof lt === "object") {
    const p50 = lt.p50 ?? lt.p60;
    const p90 = lt.p90 ?? lt.p95 ?? lt.p80;
    if (typeof p50 === "number" && Number.isFinite(p50) && p50 >= 0) {
      const minD = Math.max(1, Math.ceil(p50 / 24));
      const maxD =
        typeof p90 === "number" && Number.isFinite(p90) && p90 > 0
          ? Math.max(minD, Math.ceil(p90 / 24))
          : minD;
      const label =
        minD === maxD ? pluralJours(minD) : `${minD}–${maxD} jours ouvrés`;
      return { minDays: minD, maxDays: maxD, label };
    }
  }

  const t = (params.deliveryMethodType ?? "").toLowerCase();
  if (t.includes("same_day")) {
    return { minDays: 0, maxDays: 1, label: "Livraison le jour même" };
  }
  if (t.includes("nominated")) {
    return { minDays: 2, maxDays: 5, label: "2–5 jours ouvrés" };
  }
  if (t.includes("service_point") || t.includes("pickup")) {
    return { minDays: 2, maxDays: 4, label: "2–4 jours ouvrés" };
  }
  return { minDays: 2, maxDays: 3, label: "2–3 jours ouvrés" };
}
