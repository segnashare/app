type WalletTxRow = {
  direction: "credit" | "debit";
  metadata?: Record<string, unknown> | null;
};

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Masque les crédits prêt dont la pièce n'est plus en `verified` (historique obsolète). */
export async function filterWalletTransactionsForAnnouncement<
  T extends WalletTxRow,
>(supabase: { from: (table: string) => unknown }, rows: T[]): Promise<T[]> {
  const lendCreditItemIds = [
    ...new Set(
      rows
        .filter((row) => {
          if (row.direction !== "credit") return false;
          const source = readMetaString(row.metadata, "source")?.toLowerCase() ?? "";
          return source === "lend_intake_verified";
        })
        .map((row) => readMetaString(row.metadata, "item_id"))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (lendCreditItemIds.length === 0) return rows;

  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, values: string[]) => Promise<{ data: unknown[] | null }>;
      };
    };
  };

  const { data } = await client
    .from("item_intake")
    .select("item_id, fulfillment_stage")
    .in("item_id", lendCreditItemIds);

  const verifiedItemIds = new Set<string>();
  for (const row of data ?? []) {
    const r = row as { item_id?: string; fulfillment_stage?: string | null };
    const itemId = String(r.item_id ?? "").trim();
    if (!itemId) continue;
    if (String(r.fulfillment_stage ?? "").trim().toLowerCase() === "verified") {
      verifiedItemIds.add(itemId);
    }
  }

  return rows.filter((row) => {
    if (row.direction !== "credit") return true;
    const source = readMetaString(row.metadata, "source")?.toLowerCase() ?? "";
    if (source !== "lend_intake_verified") return true;
    const itemId = readMetaString(row.metadata, "item_id");
    return Boolean(itemId && verifiedItemIds.has(itemId));
  });
}
