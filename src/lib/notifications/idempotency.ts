import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationDeliveryChannels =
  | "none"
  | "email"
  | "phone"
  | "email+phone"
  | "push"
  | "email+push"
  | "phone+push"
  | "email+phone+push";

export function mergeDeliveryChannels(
  current: NotificationDeliveryChannels | null,
  next: "email" | "phone" | "push",
): NotificationDeliveryChannels {
  const hasEmail = Boolean(current?.includes("email")) || next === "email";
  const hasPhone = Boolean(current?.includes("phone")) || next === "phone";
  const hasPush = Boolean(current?.includes("push")) || next === "push";
  if (hasEmail && hasPhone && hasPush) return "email+phone+push";
  if (hasEmail && hasPhone) return "email+phone";
  if (hasEmail && hasPush) return "email+push";
  if (hasPhone && hasPush) return "phone+push";
  if (hasEmail) return "email";
  if (hasPhone) return "phone";
  if (hasPush) return "push";
  return "none";
}

export async function claimNotificationSend(
  admin: SupabaseClient,
  input: {
    idempotencyKey: string;
    kind: string;
    userId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await admin.from("notification_send_log").insert({
    idempotency_key: input.idempotencyKey,
    kind: input.kind,
    user_id: input.userId,
    metadata: input.metadata ?? {},
    delivery_channels: "none",
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[notifications] claimNotificationSend insert", error.message);
  return false;
}

export async function releaseNotificationSend(admin: SupabaseClient, idempotencyKey: string): Promise<void> {
  const { error } = await admin.from("notification_send_log").delete().eq("idempotency_key", idempotencyKey);
  if (error) {
    console.error("[notifications] releaseNotificationSend", error.message);
  }
}

export async function setNotificationDeliveryChannels(
  admin: SupabaseClient,
  idempotencyKey: string,
  deliveryChannels: NotificationDeliveryChannels,
): Promise<void> {
  const { error } = await admin
    .from("notification_send_log")
    .update({ delivery_channels: deliveryChannels })
    .eq("idempotency_key", idempotencyKey);
  if (error) {
    console.error("[notifications] setNotificationDeliveryChannels", error.message);
  }
}
