import type { SupabaseClient } from "@supabase/supabase-js";

export type DevicePushTokenRow = {
  id: string;
  expo_push_token: string;
  platform: "ios" | "android";
};

export async function upsertDevicePushToken(
  admin: SupabaseClient,
  input: {
    userId: string;
    expoPushToken: string;
    platform: "ios" | "android";
    deviceId?: string | null;
    appVersion?: string | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = input.expoPushToken.trim();
  if (!token.startsWith("ExponentPushToken[") && !token.startsWith("ExpoPushToken[")) {
    return { ok: false, message: "Jeton push invalide." };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("device_push_tokens").upsert(
    {
      user_id: input.userId,
      expo_push_token: token,
      platform: input.platform,
      device_id: input.deviceId?.trim() || null,
      app_version: input.appVersion?.trim() || null,
      last_seen_at: now,
      disabled_at: null,
    },
    { onConflict: "expo_push_token" },
  );

  if (error) {
    console.error("[notifications] upsertDevicePushToken", error.message);
    return { ok: false, message: "Impossible d’enregistrer le jeton." };
  }
  return { ok: true };
}

export async function disableDevicePushToken(
  admin: SupabaseClient,
  expoPushToken: string,
): Promise<void> {
  const token = expoPushToken.trim();
  if (!token) return;
  const { error } = await admin
    .from("device_push_tokens")
    .update({ disabled_at: new Date().toISOString() })
    .eq("expo_push_token", token);
  if (error) {
    console.error("[notifications] disableDevicePushToken", error.message);
  }
}

export async function deleteDevicePushTokenForUser(
  admin: SupabaseClient,
  input: { userId: string; expoPushToken?: string | null },
): Promise<void> {
  let query = admin.from("device_push_tokens").delete().eq("user_id", input.userId);
  const token = input.expoPushToken?.trim();
  if (token) {
    query = query.eq("expo_push_token", token);
  }
  const { error } = await query;
  if (error) {
    console.error("[notifications] deleteDevicePushTokenForUser", error.message);
  }
}

export async function listActiveDevicePushTokens(
  admin: SupabaseClient,
  userId: string,
): Promise<DevicePushTokenRow[]> {
  const { data, error } = await admin
    .from("device_push_tokens")
    .select("id,expo_push_token,platform")
    .eq("user_id", userId)
    .is("disabled_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[notifications] listActiveDevicePushTokens", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const token = typeof row.expo_push_token === "string" ? row.expo_push_token : "";
      const platform = row.platform === "android" ? "android" : row.platform === "ios" ? "ios" : null;
      const id = typeof row.id === "string" ? row.id : "";
      if (!token || !platform || !id) return null;
      return { id, expo_push_token: token, platform } satisfies DevicePushTokenRow;
    })
    .filter((row): row is DevicePushTokenRow => Boolean(row));
}
