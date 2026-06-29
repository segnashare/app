import type { SupabaseClient } from "@supabase/supabase-js";

export type BorrowCartInvoiceLine = {
  label: string;
  valueCents: number;
};

type CartItemRow = {
  items?: {
    title?: string | null;
    price_points?: number | null;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | null;
  } | null;
};

function itemLabel(row: CartItemRow): string {
  const item = row.items;
  const brand =
    (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
    item?.item_brands?.label?.trim() ||
    "";
  const title = String(item?.title ?? "").trim();
  if (brand && title) return `${brand} — ${title}`;
  return title || brand || "Pièce Segna";
}

/** Lignes facture non-restitution : 1 crédit = 1 € (100 cts), aligné resolve_cart_borrow_value_cents. */
export async function fetchBorrowCartInvoiceLines(
  admin: SupabaseClient,
  cartId: string,
): Promise<BorrowCartInvoiceLine[]> {
  const { data: rows, error } = await admin
    .from("cart_items")
    .select(
      "items(title, price_points, item_custom_brand_label, item_brands(label))",
    )
    .eq("cart_id", cartId)
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  const lines: BorrowCartInvoiceLine[] = [];
  for (const row of (rows ?? []) as CartItemRow[]) {
    const points = Math.max(0, Math.trunc(Number(row.items?.price_points ?? 0)));
    if (points <= 0) continue;
    lines.push({
      label: itemLabel(row),
      valueCents: points * 100,
    });
  }

  return lines;
}
