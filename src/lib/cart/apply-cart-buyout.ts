type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type ApplyCartBuyoutInput = {
  userId: string;
  cartId: string;
  amountCents: number;
  discountPercent: number;
  retailCents: number;
  cartItemIds: string[];
  itemIds: string[];
  checkoutSessionId: string;
  paymentIntentId: string | null;
};

export type ApplyCartBuyoutResult = {
  applied: boolean;
  reason?: string;
  archived?: boolean;
  via?: "rpc" | "direct";
};

export async function applyCartBuyout(
  admin: AdminClient,
  input: ApplyCartBuyoutInput,
): Promise<ApplyCartBuyoutResult> {
  const rpcArgs = {
    p_user_id: input.userId,
    p_cart_id: input.cartId,
    p_amount_cents: input.amountCents,
    p_discount_percent: input.discountPercent,
    p_retail_cents: input.retailCents,
    p_cart_item_ids: input.cartItemIds,
    p_item_ids: input.itemIds,
    p_checkout_session_id: input.checkoutSessionId,
    p_payment_intent_id: input.paymentIntentId,
  };

  const { data: rpcResult, error: rpcError } = await admin.rpc("apply_cart_buyout", rpcArgs);
  if (!rpcError) {
    const rpc = rpcResult as { applied?: boolean; reason?: string; archived?: boolean } | null;
    if (rpc?.applied === true || rpc?.reason === "already_applied") {
      return {
        applied: true,
        reason: rpc?.reason,
        archived: Boolean(rpc?.archived),
        via: "rpc",
      };
    }
    if (rpc?.reason) {
      return { applied: false, reason: rpc.reason, via: "rpc" };
    }
  }

  return applyCartBuyoutDirect(admin, input, rpcError?.message);
}

async function applyCartBuyoutDirect(
  admin: AdminClient,
  input: ApplyCartBuyoutInput,
  rpcErrorMessage?: string,
): Promise<ApplyCartBuyoutResult> {
  const { data: existing, error: existingError } = await admin
    .from("cart_buyouts")
    .select("id")
    .eq("stripe_checkout_session_id", input.checkoutSessionId)
    .maybeSingle();

  if (existingError) {
    const msg = existingError.message ?? "";
    if (msg.includes("cart_buyouts") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return { applied: false, reason: "migration_missing" };
    }
    return { applied: false, reason: rpcErrorMessage ?? "direct_lookup_failed" };
  }

  if (existing?.id) {
    return { applied: true, reason: "already_applied", via: "direct" };
  }

  const { data: cart, error: cartError } = await admin
    .from("carts")
    .select("user_id,status,checkout_purchase_mode")
    .eq("id", input.cartId)
    .maybeSingle();
  if (cartError || !cart?.user_id) {
    return { applied: false, reason: "cart_not_found" };
  }
  if (cart.user_id !== input.userId) {
    return { applied: false, reason: "forbidden" };
  }
  if (String(cart.status) !== "confirmed") {
    return { applied: false, reason: "cart_not_confirmed" };
  }
  if (cart.checkout_purchase_mode === true) {
    return { applied: false, reason: "purchase_order" };
  }

  const { data: lines, error: linesError } = await admin
    .from("cart_items")
    .select("id,item_id,status,dispute_line_status,items(id,status,deleted_at)")
    .eq("cart_id", input.cartId)
    .in("id", input.cartItemIds)
    .is("deleted_at", null);

  if (linesError) {
    return { applied: false, reason: "lines_lookup_failed" };
  }

  const rows = (lines ?? []) as Array<{
    id?: string;
    item_id?: string;
    status?: string;
    dispute_line_status?: string | null;
    items?: { id?: string; status?: string; deleted_at?: string | null } | Array<{
      id?: string;
      status?: string;
      deleted_at?: string | null;
    }> | null;
  }>;

  if (rows.length !== input.cartItemIds.length) {
    return { applied: false, reason: "items_unavailable" };
  }

  const itemIdSet = new Set(input.itemIds);
  for (const row of rows) {
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    if (
      !row.id ||
      !row.item_id ||
      !itemIdSet.has(row.item_id) ||
      row.status !== "reserved" ||
      item?.status !== "reserved" ||
      item?.deleted_at ||
      String(row.dispute_line_status ?? "") === "lost_not_returned"
    ) {
      return { applied: false, reason: "items_unavailable" };
    }
  }

  const { error: insertError } = await admin.from("cart_buyouts").insert({
    cart_id: input.cartId,
    user_id: input.userId,
    amount_cents: input.amountCents,
    discount_percent: input.discountPercent,
    retail_cents: input.retailCents,
    cart_item_ids: input.cartItemIds,
    item_ids: input.itemIds,
    stripe_checkout_session_id: input.checkoutSessionId,
    stripe_payment_intent_id: input.paymentIntentId,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { applied: true, reason: "already_applied", via: "direct" };
    }
    const msg = insertError.message ?? "";
    if (msg.includes("cart_buyouts") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return { applied: false, reason: "migration_missing" };
    }
    return { applied: false, reason: rpcErrorMessage ?? "direct_insert_failed" };
  }

  const { error: soldError } = await admin
    .from("items")
    .update({ status: "sold", updated_at: new Date().toISOString() })
    .in("id", input.itemIds)
    .eq("status", "reserved");

  if (soldError) {
    console.error("[apply-cart-buyout] mark sold failed", soldError.message);
    return { applied: false, reason: "mark_sold_failed" };
  }

  const { data: remainingRows } = await admin
    .from("cart_items")
    .select("id,items(status)")
    .eq("cart_id", input.cartId)
    .eq("status", "reserved")
    .is("deleted_at", null);

  const remainingReserved = (remainingRows ?? []).filter(
    (row: { items?: { status?: string } | Array<{ status?: string }> | null }) => {
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      return item?.status === "reserved";
    },
  ).length;

  let archived = false;
  if (remainingReserved === 0) {
    const nowIso = new Date().toISOString();
    const { error: archiveError } = await admin
      .from("carts")
      .update({ status: "archived", updated_at: nowIso })
      .eq("id", input.cartId)
      .eq("status", "confirmed");
    if (!archiveError) {
      archived = true;
      await admin.from("cart_status_history").insert({
        cart_id: input.cartId,
        from_status: "confirmed",
        to_status: "archived",
        reason: "rental_buyout_complete",
        actor_user_id: input.userId,
      });
    }
  }

  return { applied: true, archived, via: "direct" };
}
