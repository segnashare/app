import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Types code : absents de la table = activés.
 * Règles custom `rule:{uuid}` : gérées via `notification_rules.enabled` (pas ici).
 */
export async function isNotificationKindEnabled(
  admin: SupabaseClient,
  kind: string,
): Promise<boolean> {
  const k = kind.trim();
  if (!k) return false;
  if (k.startsWith("rule:")) return true;

  const { data, error } = await admin
    .from("notification_kind_settings")
    .select("enabled")
    .eq("kind", k)
    .maybeSingle();

  if (error) {
    // Fail-open si table absente / erreur ponctuelle : ne pas bloquer la prod.
    console.warn("[notifications] kind settings lookup", error.message);
    return true;
  }
  if (!data) return true;
  return (data as { enabled?: boolean }).enabled !== false;
}

export async function listDisabledNotificationKinds(
  admin: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("notification_kind_settings")
    .select("kind")
    .eq("enabled", false);
  if (error) {
    console.warn("[notifications] list disabled kinds", error.message);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((r) => (r as { kind?: string }).kind)
      .filter((k): k is string => typeof k === "string" && k.length > 0),
  );
}
