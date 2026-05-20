import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Complète `sizes.code` depuis `public.sizes` lorsque la RPC facettes
 * n’expose pas encore le code (cache / migration non appliquée).
 */
export async function enrichShopFilterSizesWithCode(
  db: SupabaseClient<Database>,
  rows: unknown,
): Promise<unknown> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const needsLookup = rows.some((row) => {
    const r = row as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code.trim() : "";
    return !code;
  });
  if (!needsLookup) return rows;

  const ids = [
    ...new Set(
      rows
        .map((row) => {
          const r = row as Record<string, unknown>;
          return typeof r.id === "string" ? r.id : "";
        })
        .filter((id) => id.length > 0),
    ),
  ];
  if (ids.length === 0) return rows;

  const byId = new Map<string, string>();
  const chunk = 120;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await db.from("sizes").select("id, code").in("id", slice);
    if (error) continue;
    for (const row of data ?? []) {
      const id = typeof row.id === "string" ? row.id : null;
      const code = typeof row.code === "string" ? row.code.trim() : "";
      if (id && code) byId.set(id, code);
    }
  }
  if (byId.size === 0) return rows;

  return rows.map((row) => {
    const r = { ...(row as Record<string, unknown>) };
    const id = typeof r.id === "string" ? r.id : "";
    const fromRpc = typeof r.code === "string" ? r.code.trim() : "";
    const fromTable = byId.get(id) ?? "";
    const code = fromRpc || fromTable;
    if (code) r.code = code;
    return r;
  });
}
