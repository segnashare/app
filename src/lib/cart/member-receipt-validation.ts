/** Délai avant validation automatique après livraison aller (`shipments.updated_at`). */
export const MEMBER_RECEIPT_AUTO_CONFIRM_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export type MemberReceiptShipmentAnchor = {
  status: string;
  updated_at: string;
};

/** Adaptateur détail commande (`updatedAt`) → ancrage auto-validation. */
export function memberReceiptAnchorFromOrderShipment(
  shipment: { status: string; updatedAt: string } | null | undefined,
): MemberReceiptShipmentAnchor | null {
  if (!shipment) return null;
  return { status: shipment.status, updated_at: shipment.updatedAt };
}

export function isOutboundDeliveredForReceipt(
  shipment: MemberReceiptShipmentAnchor | null | undefined,
): boolean {
  return shipment?.status?.trim().toLowerCase() === "delivered";
}

export function memberReceiptAutoConfirmEligibleAtMs(shipment: MemberReceiptShipmentAnchor): number {
  const anchor = Date.parse(shipment.updated_at);
  if (Number.isNaN(anchor)) return Number.NaN;
  return anchor + MEMBER_RECEIPT_AUTO_CONFIRM_AFTER_MS;
}

/** Auto-validation échue (2 jours après `updated_at` livraison), sans confirmation manuelle. */
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

/** Accès page emprunt : confirmation manuelle ou auto après 2 jours. */
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

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("carts")
    .update({ member_receipt_confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", cartId)
    .eq("user_id", userId);

  if (error) return null;
  return nowIso;
}
