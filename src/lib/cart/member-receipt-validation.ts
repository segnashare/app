import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";

/** Délai avant validation automatique après livraison aller (`delivered_at` ou repli `updated_at`). */
export const MEMBER_RECEIPT_AUTO_CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

export type MemberReceiptShipmentAnchor = {
  status: string;
  delivered_at: string | null;
  updated_at: string;
};

/** Adaptateur détail commande → ancrage auto-validation. */
export function memberReceiptAnchorFromOrderShipment(
  shipment: { status: string; updatedAt: string; deliveredAt?: string | null } | null | undefined,
): MemberReceiptShipmentAnchor | null {
  if (!shipment) return null;
  return {
    status: shipment.status,
    delivered_at: shipment.deliveredAt ?? null,
    updated_at: shipment.updatedAt,
  };
}

export function memberReceiptAnchorFromOutboundShipment(
  shipment: { status: string; updated_at: string; delivered_at?: string | null } | null | undefined,
): MemberReceiptShipmentAnchor | null {
  if (!shipment) return null;
  return {
    status: shipment.status,
    delivered_at: shipment.delivered_at ?? null,
    updated_at: shipment.updated_at,
  };
}

export function resolveMemberReceiptDeliveredAnchorIso(
  shipment: MemberReceiptShipmentAnchor,
): string | null {
  return resolveOutboundBorrowDeliveredAtIso(shipment.delivered_at, shipment.updated_at);
}

export function isOutboundDeliveredForReceipt(
  shipment: MemberReceiptShipmentAnchor | null | undefined,
): boolean {
  return shipment?.status?.trim().toLowerCase() === "delivered";
}

export function memberReceiptAutoConfirmEligibleAtMs(shipment: MemberReceiptShipmentAnchor): number {
  const anchorIso = resolveMemberReceiptDeliveredAnchorIso(shipment);
  if (!anchorIso) return Number.NaN;
  const anchor = Date.parse(anchorIso);
  if (Number.isNaN(anchor)) return Number.NaN;
  return anchor + MEMBER_RECEIPT_AUTO_CONFIRM_AFTER_MS;
}

/** Instant figé de validation auto : livraison aller + délai (pas « maintenant »). */
export function resolveMemberReceiptAutoConfirmedAtIso(
  shipment: MemberReceiptShipmentAnchor,
): string | null {
  const eligibleMs = memberReceiptAutoConfirmEligibleAtMs(shipment);
  if (!Number.isFinite(eligibleMs)) return null;
  return new Date(eligibleMs).toISOString();
}

/** Auto-validation échue (24 h après livraison aller), sans confirmation manuelle. */
export function isMemberReceiptAutoConfirmDue(
  shipment: MemberReceiptShipmentAnchor,
  memberReceiptConfirmedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (memberReceiptConfirmedAt?.trim()) return false;
  if (!isOutboundDeliveredForReceipt(shipment)) return false;
  const eligibleAt = memberReceiptAutoConfirmEligibleAtMs(shipment);
  return Number.isFinite(eligibleAt) && nowMs >= eligibleAt;
}

export function memberReceiptAutoConfirmRemainingMs(
  shipment: MemberReceiptShipmentAnchor,
  nowMs = Date.now(),
): number {
  const eligibleAt = memberReceiptAutoConfirmEligibleAtMs(shipment);
  if (!Number.isFinite(eligibleAt)) return Number.NaN;
  return Math.max(0, eligibleAt - nowMs);
}

export function formatMemberReceiptAutoConfirmRemainingFr(remainingMs: number): string | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes >= 60) {
    const hours = Math.ceil(totalMinutes / 60);
    return hours === 1
      ? "Sans action de ta part, validation automatique dans 1 h."
      : `Sans action de ta part, validation automatique dans ${hours} h.`;
  }
  if (totalMinutes <= 1) {
    return "Sans action de ta part, validation automatique imminente.";
  }
  return `Sans action de ta part, validation automatique dans ${totalMinutes} min.`;
}

/** Accès page emprunt : confirmation manuelle ou auto après 24 h. */
export function isMemberReceiptValidated(
  memberReceiptConfirmedAt: string | null | undefined,
  shipment: MemberReceiptShipmentAnchor | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (memberReceiptConfirmedAt?.trim()) return true;
  if (!shipment) return false;
  return isMemberReceiptAutoConfirmDue(shipment, null, nowMs);
}

/** Persiste `member_receipt_confirmed_at` si l’auto-validation est due. */
export async function ensureMemberReceiptAutoConfirmed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: {
    cartId: string;
    userId: string;
    memberReceiptConfirmedAt: string | null | undefined;
    shipment: MemberReceiptShipmentAnchor | null | undefined;
    nowMs?: number;
  },
): Promise<string | null> {
  const existing = input.memberReceiptConfirmedAt?.trim() || null;
  if (existing) return existing;

  const { shipment, cartId, userId } = input;
  if (!shipment || !isMemberReceiptAutoConfirmDue(shipment, null, input.nowMs)) {
    return null;
  }

  const confirmedAtIso = resolveMemberReceiptAutoConfirmedAtIso(shipment);
  if (!confirmedAtIso) return null;

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("carts")
    .update({ member_receipt_confirmed_at: confirmedAtIso, updated_at: nowIso })
    .eq("id", cartId)
    .eq("user_id", userId)
    .is("member_receipt_confirmed_at", null);

  if (error) return null;
  return confirmedAtIso;
}

/** PostHog : à appeler côté serveur si `ensureMemberReceiptAutoConfirmed` vient de persister. */
export function shouldTrackAutoOrderReceived(
  previousConfirmedAt: string | null | undefined,
  newConfirmedAt: string | null,
): boolean {
  return Boolean(newConfirmedAt?.trim() && !previousConfirmedAt?.trim());
}
