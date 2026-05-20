import type { MemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  applyBorrowExtensionDaysToDeadlineMs,
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
 * sinon repli calculé livraison + membership + somme des extensions (paniers legacy).
 */
export function resolveCartBorrowReturnDueMs(input: {
  borrowReturnDueAtIso?: string | null;
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

  const deliveredIso = resolveOutboundBorrowDeliveredAtIso(
    input.outboundDeliveredAtIso,
    input.outboundUpdatedAtIso,
  );
  if (!deliveredIso) return Number.NaN;

  const deliveredMs = Date.parse(deliveredIso);
  const base = computeBorrowDeadlineMs(deliveredMs, input.membershipLabel);
  return applyBorrowExtensionDaysToDeadlineMs(base, input.borrowExtensionDaysTotal ?? 0);
}

export function resolveMemberCartBorrowReturnDueMs(
  detail: Pick<MemberCartOrderDetail, "borrowReturnDueAt" | "shipment">,
  membershipLabel: SegnaBorrowMembershipLabel,
  borrowExtensionDaysTotal = 0,
): number {
  return resolveCartBorrowReturnDueMs({
    borrowReturnDueAtIso: detail.borrowReturnDueAt,
    outboundDeliveredAtIso: detail.shipment?.deliveredAt,
    outboundUpdatedAtIso: detail.shipment?.updatedAt,
    membershipLabel,
    borrowExtensionDaysTotal,
  });
}
