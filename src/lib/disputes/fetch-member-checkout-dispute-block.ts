import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberCheckoutDisputeBlock = {
  blocked: boolean;
  reason: string | null;
  cartDisputeId: string | null;
  itemDisputeId: string | null;
};

/**
 * Litige panier ou pièce encore ouvert (`open` / `in_review`) → pas de nouvelle commande.
 */
export async function fetchMemberCheckoutDisputeBlock(
  admin: SupabaseClient,
  userId: string,
): Promise<MemberCheckoutDisputeBlock> {
  const uid = userId.trim();
  if (!uid) {
    return { blocked: false, reason: null, cartDisputeId: null, itemDisputeId: null };
  }

  const { data: ownedCarts } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", uid)
    .is("deleted_at", null)
    .limit(120);
  const cartIds = (ownedCarts ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter(Boolean);
  if (cartIds.length === 0) {
    return { blocked: false, reason: null, cartDisputeId: null, itemDisputeId: null };
  }

  const { data: openCartDisputes } = await admin
    .from("cart_disputes")
    .select("id")
    .in("cart_id", cartIds)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .order("updated_at", { ascending: false })
    .limit(1);
  const cartDisputeId =
    typeof openCartDisputes?.[0]?.id === "string" ? openCartDisputes[0].id : null;
  if (cartDisputeId) {
    return {
      blocked: true,
      reason:
        "Tu as un litige en cours. Règle-le ou attends sa clôture avant de réserver un nouveau panier.",
      cartDisputeId,
      itemDisputeId: null,
    };
  }

  const { data: allCd } = await admin
    .from("cart_disputes")
    .select("id")
    .in("cart_id", cartIds)
    .is("deleted_at", null)
    .limit(80);
  const cdIds = (allCd ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter(Boolean);
  if (cdIds.length === 0) {
    return { blocked: false, reason: null, cartDisputeId: null, itemDisputeId: null };
  }

  const { data: openItems } = await admin
    .from("item_disputes")
    .select("id, cart_dispute_id")
    .in("cart_dispute_id", cdIds)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .order("updated_at", { ascending: false })
    .limit(1);
  const itemDisputeId = typeof openItems?.[0]?.id === "string" ? openItems[0].id : null;
  if (itemDisputeId) {
    return {
      blocked: true,
      reason:
        "Tu as un litige pièce en cours. Clôture-le (et règle la facture si besoin) avant de réserver un nouveau panier.",
      cartDisputeId:
        typeof openItems?.[0]?.cart_dispute_id === "string"
          ? openItems[0].cart_dispute_id
          : null,
      itemDisputeId,
    };
  }

  return { blocked: false, reason: null, cartDisputeId: null, itemDisputeId: null };
}
