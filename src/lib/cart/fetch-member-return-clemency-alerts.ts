import type { SupabaseClient } from "@supabase/supabase-js";

import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

export type MemberReturnClemencyAlert = {
  cartItemId: string;
  cartId: string;
  itemId: string;
  itemTitle: string;
  description: string | null;
  photoUrls: string[];
  commandeHref: string;
  orderLabel: string;
};

function formatOrderCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Alertes « défaut réversible / clémence » en attente d’acquittement membre.
 * Source : `cart_items.return_verification.member_clemency_alert.status = pending`.
 */
export async function fetchMemberPendingReturnClemencyAlerts(
  admin: SupabaseClient,
  userId: string,
): Promise<MemberReturnClemencyAlert[]> {
  const { data: carts, error: cErr } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(40);
  if (cErr || !carts?.length) return [];

  const cartIds = carts.map((c) => (c as { id: string }).id);
  const { data: lines, error: lErr } = await admin
    .from("cart_items")
    .select("id, cart_id, item_id, return_verification, items(title)")
    .in("cart_id", cartIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(80);
  if (lErr || !lines?.length) return [];

  const pending = lines.filter((row) => {
    const rv = (row as { return_verification?: unknown }).return_verification;
    if (!rv || typeof rv !== "object" || Array.isArray(rv)) return false;
    const v = rv as Record<string, unknown>;
    if (String(v.defect_kind ?? "").trim() !== "reversible") return false;
    const alert = v.member_clemency_alert;
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) return false;
    return String((alert as { status?: unknown }).status ?? "").trim() === "pending";
  });
  if (pending.length === 0) return [];

  const allPaths: string[] = [];
  for (const row of pending) {
    const rv = (row as { return_verification?: unknown }).return_verification;
    if (!rv || typeof rv !== "object" || Array.isArray(rv)) continue;
    const paths = (rv as { photo_paths?: unknown }).photo_paths;
    if (!Array.isArray(paths)) continue;
    for (const p of paths) {
      if (typeof p === "string" && p.trim()) allPaths.push(p.trim());
    }
  }
  const signed =
    allPaths.length > 0
      ? await createSignedUrlsForStoragePaths(admin, [...new Set(allPaths)], 60 * 60 * 12, {
          explicitBucket: "bucket_items",
        })
      : new Map<string, string>();

  return pending.map((row) => {
    const cartId = String((row as { cart_id: string }).cart_id);
    const cartItemId = String((row as { id: string }).id);
    const itemId = String((row as { item_id: string }).item_id);
    const itemsRaw = (row as { items?: unknown }).items;
    const item =
      itemsRaw && typeof itemsRaw === "object" && !Array.isArray(itemsRaw)
        ? (itemsRaw as { title?: string | null })
        : null;
    const itemTitle =
      typeof item?.title === "string" && item.title.trim() ? item.title.trim() : "Pièce";
    const rv = (row as { return_verification: Record<string, unknown> }).return_verification;
    const description =
      typeof rv.note === "string" && rv.note.trim() ? rv.note.trim() : null;
    const paths = Array.isArray(rv.photo_paths)
      ? rv.photo_paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    const photoUrls = paths.map((p) => signed.get(p)).filter((u): u is string => Boolean(u));

    return {
      cartItemId,
      cartId,
      itemId,
      itemTitle,
      description,
      photoUrls,
      commandeHref: `/commande/${cartId}`,
      orderLabel: formatOrderCompact(cartId),
    };
  });
}

export async function acknowledgeMemberReturnClemencyAlert(
  admin: SupabaseClient,
  userId: string,
  cartItemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = cartItemId.trim();
  if (!id) return { ok: false, error: "cart_item_id_required" };

  const { data: line, error } = await admin
    .from("cart_items")
    .select("id, cart_id, return_verification, carts!inner(user_id)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !line) return { ok: false, error: "line_not_found" };

  const cartUser = (line as { carts?: { user_id?: string } | { user_id?: string }[] }).carts;
  const owner =
    cartUser && !Array.isArray(cartUser)
      ? cartUser.user_id
      : Array.isArray(cartUser)
        ? cartUser[0]?.user_id
        : null;
  if (owner !== userId) return { ok: false, error: "forbidden" };

  const rvRaw = (line as { return_verification?: unknown }).return_verification;
  const rv =
    rvRaw && typeof rvRaw === "object" && !Array.isArray(rvRaw)
      ? { ...(rvRaw as Record<string, unknown>) }
      : {};
  const prevAlert =
    rv.member_clemency_alert &&
    typeof rv.member_clemency_alert === "object" &&
    !Array.isArray(rv.member_clemency_alert)
      ? { ...(rv.member_clemency_alert as Record<string, unknown>) }
      : {};

  rv.member_clemency_alert = {
    ...prevAlert,
    status: "acknowledged",
    acknowledged_at: new Date().toISOString(),
  };

  const { error: upErr } = await admin
    .from("cart_items")
    .update({ return_verification: rv, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}
