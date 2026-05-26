import type { SupabaseClient } from "@supabase/supabase-js";

type ActivityRow = { user_id: string; last_activity_at: string };

/**
 * Dernière activité app (événements, feed, `users.updated_at`) via RPC Postgres.
 */
export async function fetchMemberLastAppActivityMsByUserIds(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, number>();
  if (unique.length === 0) return out;

  const { data, error } = await admin.rpc("get_members_last_app_activity_at", {
    p_user_ids: unique,
  });
  if (error) {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as ActivityRow[]) {
    const uid = typeof row.user_id === "string" ? row.user_id : "";
    const iso = typeof row.last_activity_at === "string" ? row.last_activity_at : "";
    const ms = iso ? Date.parse(iso) : NaN;
    if (uid && Number.isFinite(ms)) out.set(uid, ms);
  }

  return out;
}
