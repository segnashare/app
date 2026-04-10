import { getMemberOutboundShipmentPhaseCopy } from "@/lib/cart/member-outbound-shipment-copy";

export type OrderTimelineEntry = { timeLabel: string; label: string };

function formatDateTimeFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function historyLabel(toStatus: string, reason: string | null): string | null {
  switch (toStatus) {
    case "checkout_pending":
      return "Paiement en cours";
    case "confirmed":
      return reason === "stripe_checkout_paid" ? "Paiement confirmé" : "Commande confirmée";
    case "archived":
      return "Commande archivée";
    case "canceled":
      return "Commande annulée";
    default:
      return null;
  }
}

type HistoryRow = { created_at: string; to_status: string; reason: string | null };

type ShipmentSlice = { created_at: string; updated_at: string; status: string };

/**
 * Frise type « détails livraison » : événements triés (panier, historique statuts, expédition).
 */
export function buildMemberOrderTimeline(
  cartCreatedAt: string,
  historyRows: HistoryRow[],
  shipment: ShipmentSlice | null,
): OrderTimelineEntry[] {
  type Ev = { t: number; label: string };
  const events: Ev[] = [];

  const createdMs = Date.parse(cartCreatedAt);
  if (!Number.isNaN(createdMs)) {
    events.push({ t: createdMs, label: "Commande créée" });
  }

  for (const h of historyRows) {
    const line = historyLabel(h.to_status, h.reason);
    if (!line) continue;
    const ms = Date.parse(h.created_at);
    if (Number.isNaN(ms)) continue;
    events.push({ t: ms, label: line });
  }

  if (shipment) {
    const cMs = Date.parse(shipment.created_at);
    const uMs = Date.parse(shipment.updated_at);
    if (!Number.isNaN(cMs)) {
      events.push({ t: cMs, label: "Prise en charge logistique" });
    }
    if (!Number.isNaN(uMs)) {
      const phase = getMemberOutboundShipmentPhaseCopy(shipment.status);
      events.push({ t: uMs, label: phase.title });
    }
  }

  events.sort((a, b) => a.t - b.t);

  const dedup: Ev[] = [];
  for (const e of events) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.label === e.label && Math.abs(prev.t - e.t) < 2_000) continue;
    dedup.push(e);
  }

  return dedup.map((e) => ({
    timeLabel: formatDateTimeFr(new Date(e.t).toISOString()),
    label: e.label,
  }));
}
