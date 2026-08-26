import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartTotalLossFromLineStatuses } from "@/lib/disputes/cart-total-loss";

export async function isCartTotalLossSettled(
  admin: SupabaseClient,
  cartId: string,
): Promise<boolean> {
  const id = String(cartId ?? "").trim();
  if (!id) return false;

  const { data: lines } = await admin
    .from("cart_items")
    .select("dispute_line_status")
    .eq("cart_id", id)
    .is("deleted_at", null);

  const statuses = (lines ?? []).map(
    (row: { dispute_line_status?: string | null }) => row.dispute_line_status,
  );
  return isCartTotalLossFromLineStatuses(statuses);
}
