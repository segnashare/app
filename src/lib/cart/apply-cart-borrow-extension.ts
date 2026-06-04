type AdminLike = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { id?: string; user_id?: string; borrow_return_due_at?: string | null } | null;
          error: { message?: string } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string; code?: string } | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message?: string; code?: string } | null }>;
    };
  };
};

import { addBorrowCalendarDaysParis } from "@/lib/cart/borrow-return-calendar";

export type ApplyCartBorrowExtensionInput = {
  userId: string;
  cartId: string;
  extensionDays: number;
  creditsCharged: number;
  amountCents: number;
  cartItemIds: string[];
  checkoutSessionId: string;
  paymentIntentId: string | null;
};

export type ApplyCartBorrowExtensionResult = {
  applied: boolean;
  reason?: string;
  via?: "rpc" | "direct";
};

export async function applyCartBorrowExtension(
  admin: AdminLike,
  input: ApplyCartBorrowExtensionInput,
): Promise<ApplyCartBorrowExtensionResult> {
  const rpcArgs = {
    p_user_id: input.userId,
    p_cart_id: input.cartId,
    p_extension_days: input.extensionDays,
    p_credits_charged: input.creditsCharged,
    p_amount_cents: input.amountCents,
    p_cart_item_ids: input.cartItemIds,
    p_checkout_session_id: input.checkoutSessionId,
    p_payment_intent_id: input.paymentIntentId,
  };

  const { data: rpcResult, error: rpcError } = await admin.rpc("apply_cart_borrow_extension", rpcArgs);
  if (!rpcError) {
    const rpc = rpcResult as { applied?: boolean; reason?: string } | null;
    if (rpc?.applied === true || rpc?.reason === "already_applied") {
      return { applied: true, reason: rpc?.reason, via: "rpc" };
    }
    if (rpc?.reason) {
      return { applied: false, reason: rpc.reason, via: "rpc" };
    }
  }

  return applyCartBorrowExtensionDirect(admin, input, rpcError?.message);
}

/** Repli si la RPC n’est pas encore déployée (migration manquante côté DB distante). */
async function applyCartBorrowExtensionDirect(
  admin: AdminLike,
  input: ApplyCartBorrowExtensionInput,
  rpcErrorMessage?: string,
): Promise<ApplyCartBorrowExtensionResult> {
  const { data: existing, error: existingError } = await admin
    .from("cart_borrow_extensions")
    .select("id")
    .eq("stripe_checkout_session_id", input.checkoutSessionId)
    .maybeSingle();

  if (existingError) {
    const msg = existingError.message ?? "";
    if (msg.includes("cart_borrow_extensions") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return { applied: false, reason: "migration_missing" };
    }
    return { applied: false, reason: rpcErrorMessage ?? "direct_lookup_failed" };
  }

  if (existing?.id) {
    return { applied: true, reason: "already_applied", via: "direct" };
  }

  const { data: cart, error: cartError } = await admin
    .from("carts")
    .select("user_id,borrow_return_due_at")
    .eq("id", input.cartId)
    .maybeSingle();
  if (cartError || !cart?.user_id) {
    return { applied: false, reason: "cart_not_found" };
  }
  if (cart.user_id !== input.userId) {
    return { applied: false, reason: "forbidden" };
  }

  const { error: insertError } = await admin.from("cart_borrow_extensions").insert({
    cart_id: input.cartId,
    user_id: input.userId,
    extension_days: input.extensionDays,
    credits_charged: input.creditsCharged,
    amount_cents: input.amountCents,
    cart_item_ids: input.cartItemIds,
    stripe_checkout_session_id: input.checkoutSessionId,
    stripe_payment_intent_id: input.paymentIntentId,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { applied: true, reason: "already_applied", via: "direct" };
    }
    const msg = insertError.message ?? "";
    if (msg.includes("cart_borrow_extensions") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return { applied: false, reason: "migration_missing" };
    }
    return { applied: false, reason: rpcErrorMessage ?? "direct_insert_failed" };
  }

  const storedDue =
    typeof cart.borrow_return_due_at === "string" && cart.borrow_return_due_at.trim()
      ? cart.borrow_return_due_at
      : null;
  const baseMs = storedDue ? Date.parse(storedDue) : Number.NaN;
  if (Number.isFinite(baseMs)) {
    const nextIso = new Date(addBorrowCalendarDaysParis(baseMs, input.extensionDays)).toISOString();
    await admin.from("carts").update({ borrow_return_due_at: nextIso }).eq("id", input.cartId);
  }

  return { applied: true, via: "direct" };
}
