import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import { fetchCartBorrowExtensionDaysTotal } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { resolveOutboundBorrowDeliveredAtIso, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

/**
 * Persiste `carts.borrow_return_due_at` si absent (paniers legacy avant migration).
 * Retourne l’échéance en ms (stockée ou calculée).
 */
export async function ensureCartBorrowReturnDueAt(
  admin: SupabaseClient,
  input: {
    cartId: string;
    userId: string;
    borrowReturnDueAtIso?: string | null;
    outboundDeliveredAtIso?: string | null;
    outboundUpdatedAtIso?: string | null;
    borrowExtensionDaysTotal?: number;
    membershipLabel?: SegnaBorrowMembershipLabel;
  },
): Promise<number> {
  const stored =
    typeof input.borrowReturnDueAtIso === "string" ? input.borrowReturnDueAtIso.trim() : "";
  if (stored) {
    const ms = Date.parse(stored);
    if (Number.isFinite(ms)) return ms;
  }

  const membershipLabel =
    input.membershipLabel ?? (await resolveMembershipLabelForServiceRole(admin, input.userId));

  const extensionDays =
    input.borrowExtensionDaysTotal ??
    (await fetchCartBorrowExtensionDaysTotal(admin, input.cartId));

  const dueMs = resolveCartBorrowReturnDueMs({
    borrowReturnDueAtIso: null,
    outboundDeliveredAtIso: input.outboundDeliveredAtIso,
    outboundUpdatedAtIso: input.outboundUpdatedAtIso,
    membershipLabel: membershipLabel as SegnaBorrowMembershipLabel,
    borrowExtensionDaysTotal: extensionDays,
  });

  if (!Number.isFinite(dueMs)) return Number.NaN;

  const deliveredIso = resolveOutboundBorrowDeliveredAtIso(
    input.outboundDeliveredAtIso,
    input.outboundUpdatedAtIso,
  );
  if (!deliveredIso) return dueMs;

  await admin
    .from("carts")
    .update({ borrow_return_due_at: new Date(dueMs).toISOString() })
    .eq("id", input.cartId)
    .is("borrow_return_due_at", null);

  return dueMs;
}
