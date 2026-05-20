type CartDueRow = {
  id?: string;
  borrow_return_due_at?: string | null;
  member_receipt_confirmed_at?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

/** `carts.borrow_return_due_at` par panier (échéance figée, prolongations incluses). */
export async function fetchCartBorrowReturnDueAtByCartIds(
  supabase: SupabaseLike,
  cartIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (cartIds.length === 0) return out;

  const { data, error } = await supabase
    .from("carts")
    .select("id,borrow_return_due_at")
    .in("id", cartIds);

  if (error || !Array.isArray(data)) return out;

  for (const row of data as CartDueRow[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const due =
      typeof row.borrow_return_due_at === "string" ? row.borrow_return_due_at.trim() : "";
    if (id && due) out.set(id, due);
  }
  return out;
}

/** `carts.member_receipt_confirmed_at` par panier (validation réception membre). */
export async function fetchCartMemberReceiptConfirmedAtByCartIds(
  supabase: SupabaseLike,
  cartIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (cartIds.length === 0) return out;

  const { data, error } = await supabase
    .from("carts")
    .select("id,member_receipt_confirmed_at")
    .in("id", cartIds);

  if (error || !Array.isArray(data)) return out;

  for (const row of data as CartDueRow[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const confirmed =
      typeof row.member_receipt_confirmed_at === "string"
        ? row.member_receipt_confirmed_at.trim()
        : "";
    if (id && confirmed) out.set(id, confirmed);
  }
  return out;
}
