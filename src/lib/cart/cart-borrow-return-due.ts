import {
  addBorrowCalendarDaysParis,
  computeBorrowReturnDueMsFromReceiptDays,
  computeBorrowReturnDueMsFromReceiptMonth,
} from "@/lib/cart/borrow-return-calendar";
import type { MemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  applyBorrowExtensionDaysToDeadlineMs,
  BORROW_PERIOD_DAYS_GUEST,
  BORROW_PERIOD_DAYS_SEGNA_X,
  computeBorrowDeadlineMs,
  resolveOutboundBorrowDeliveredAtIso,
  type SegnaBorrowMembershipLabel,
} from "@/lib/emprunt/borrow-period";

import { BORROW_RETURN_TZ } from "@/lib/cart/borrow-return-calendar";

export function formatBorrowReturnDueDateFr(dueMs: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: BORROW_RETURN_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dueMs));
}

export function formatBorrowReturnDueDateShortFr(dueMs: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: BORROW_RETURN_TZ,
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(dueMs));
}

/**
 * Échéance de retour : `carts.borrow_return_due_at` si renseigné (inclut déjà les prolongations),
 * sinon repli réception + durée checkout (23:59 Paris), ou legacy livraison + membership.
 */
export function resolveCartBorrowReturnDueMs(input: {
  borrowReturnDueAtIso?: string | null;
  memberReceiptConfirmedAtIso?: string | null;
  checkoutBorrowDurationDays?: number | null;
  outboundDeliveredAtIso?: string | null;
  outboundUpdatedAtIso?: string | null;
  membershipLabel: SegnaBorrowMembershipLabel;
  borrowExtensionDaysTotal?: number;
}): number {
  const stored = typeof input.borrowReturnDueAtIso === "string" ? input.borrowReturnDueAtIso.trim() : "";
  if (stored) {
    const ms = Date.parse(stored);
    if (Number.isFinite(ms)) return ms;
  }

  const receiptIso =
    typeof input.memberReceiptConfirmedAtIso === "string" ? input.memberReceiptConfirmedAtIso.trim() : "";
  const extensionDays = input.borrowExtensionDaysTotal ?? 0;

  if (receiptIso) {
    const checkoutDays =
      input.checkoutBorrowDurationDays != null &&
      Number.isFinite(Number(input.checkoutBorrowDurationDays)) &&
      Number(input.checkoutBorrowDurationDays) >= 1
        ? Math.trunc(Number(input.checkoutBorrowDurationDays))
        : null;

    let baseMs: number;
    if (checkoutDays != null) {
      baseMs = computeBorrowReturnDueMsFromReceiptDays(receiptIso, checkoutDays);
    } else if (input.membershipLabel === "Membre +") {
      baseMs = computeBorrowReturnDueMsFromReceiptMonth(receiptIso);
    } else if (input.membershipLabel === "Membre X") {
      baseMs = computeBorrowReturnDueMsFromReceiptDays(receiptIso, BORROW_PERIOD_DAYS_SEGNA_X);
    } else {
      baseMs = computeBorrowReturnDueMsFromReceiptDays(receiptIso, BORROW_PERIOD_DAYS_GUEST);
    }

    if (!Number.isFinite(baseMs)) return Number.NaN;
    return addBorrowCalendarDaysParis(baseMs, extensionDays);
  }

  const deliveredIso = resolveOutboundBorrowDeliveredAtIso(
    input.outboundDeliveredAtIso,
    input.outboundUpdatedAtIso,
  );
  if (!deliveredIso) return Number.NaN;

  const deliveredMs = Date.parse(deliveredIso);
  const base = computeBorrowDeadlineMs(deliveredMs, input.membershipLabel);
  return applyBorrowExtensionDaysToDeadlineMs(base, extensionDays);
}

export function resolveMemberCartBorrowReturnDueMs(
  detail: Pick<
    MemberCartOrderDetail,
    "borrowReturnDueAt" | "memberReceiptConfirmedAt" | "checkoutBorrowDurationDays" | "shipment"
  >,
  membershipLabel: SegnaBorrowMembershipLabel,
  borrowExtensionDaysTotal = 0,
): number {
  return resolveCartBorrowReturnDueMs({
    borrowReturnDueAtIso: detail.borrowReturnDueAt,
    memberReceiptConfirmedAtIso: detail.memberReceiptConfirmedAt,
    checkoutBorrowDurationDays: detail.checkoutBorrowDurationDays,
    outboundDeliveredAtIso: detail.shipment?.deliveredAt,
    outboundUpdatedAtIso: detail.shipment?.updatedAt,
    membershipLabel,
    borrowExtensionDaysTotal,
  });
}
