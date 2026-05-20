type ExtensionRow = { cart_id?: string; extension_days: number | null };

type ExtensionsQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => PromiseLike<{ data: ExtensionRow[] | null; error: { message?: string } | null }>;
      in: (column: string, values: string[]) => PromiseLike<{ data: ExtensionRow[] | null; error: { message?: string } | null }>;
    };
  };
};

function asExtensionsClient(supabase: unknown): ExtensionsQueryClient {
  return supabase as ExtensionsQueryClient;
}

function sumExtensionDays(rows: ExtensionRow[]): number {
  return rows.reduce(
    (sum, row) => sum + (Number.isFinite(row.extension_days) ? Math.max(0, row.extension_days!) : 0),
    0,
  );
}

/** Somme des jours de prolongation payés pour un panier (toutes extensions confondues). */
export async function fetchCartBorrowExtensionDaysTotal(supabase: unknown, cartId: string): Promise<number> {
  const client = asExtensionsClient(supabase);
  const { data, error } = await client.from("cart_borrow_extensions").select("extension_days").eq("cart_id", cartId);
  if (error || !data?.length) return 0;
  return sumExtensionDays(data);
}

/** Jours de prolongation par panier (batch liste Échange). */
export async function fetchCartBorrowExtensionDaysByCartIds(
  supabase: unknown,
  cartIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (cartIds.length === 0) return out;

  const client = asExtensionsClient(supabase);
  const { data, error } = await client
    .from("cart_borrow_extensions")
    .select("cart_id, extension_days")
    .in("cart_id", cartIds);

  if (error || !data?.length) return out;

  for (const row of data) {
    const cartId = typeof row.cart_id === "string" ? row.cart_id : "";
    if (!cartId) continue;
    const add = Number.isFinite(row.extension_days) ? Math.max(0, row.extension_days!) : 0;
    out.set(cartId, (out.get(cartId) ?? 0) + add);
  }
  return out;
}
