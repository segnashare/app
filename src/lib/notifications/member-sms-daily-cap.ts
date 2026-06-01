import type { SupabaseClient } from "@supabase/supabase-js";

import { borrowReturnParisDateKey } from "@/lib/cart/borrow-return-calendar";
import { NotificationKind } from "@/lib/notifications/kinds";

/** SMS planifiés par crons membre (plafond journalier Paris). */
export const CRON_SCHEDULED_SMS_KINDS = [
  NotificationKind.borrowReturnDeadlineReminder,
  NotificationKind.borrowOverdueDaily,
  NotificationKind.onboardingIncompleteReminder,
  NotificationKind.onboardingIncompleteReminderFollowup,
  NotificationKind.abandonedCartReminder,
] as const;

const EMPRUNT_SMS_KINDS = new Set<string>([
  NotificationKind.borrowReturnDeadlineReminder,
  NotificationKind.borrowOverdueDaily,
]);

/** Max SMS cron / membre / jour civil Paris (emprunt prioritaire le soir). */
export const MEMBER_CRON_SMS_DAILY_MAX = 2;

/**
 * Engagement : max 1 SMS tant qu’un emprunt peut encore partir le même jour (19h30).
 * Emprunt : jusqu’à 2 SMS / jour (ex. retard matin + rappel soir — rare).
 */
export async function shouldSendMemberCronSms(
  admin: SupabaseClient,
  userId: string,
  kind: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const count = await countMemberCronSmsSentTodayParis(admin, userId, nowMs);
  if (EMPRUNT_SMS_KINDS.has(kind)) {
    return count < MEMBER_CRON_SMS_DAILY_MAX;
  }
  return count < 1;
}

export async function countMemberCronSmsSentTodayParis(
  admin: SupabaseClient,
  userId: string,
  nowMs: number,
): Promise<number> {
  const dayKey = borrowReturnParisDateKey(nowMs);
  const since = new Date(nowMs - 48 * 3_600_000).toISOString();

  const { data, error } = await admin
    .from("notification_send_log")
    .select("kind, delivery_channels, created_at")
    .eq("user_id", userId)
    .in("kind", [...CRON_SCHEDULED_SMS_KINDS])
    .in("delivery_channels", ["phone", "email+phone"])
    .gte("created_at", since);

  if (error) {
    console.error("[notifications] countMemberCronSmsSentTodayParis", error.message);
    return MEMBER_CRON_SMS_DAILY_MAX;
  }

  return (data ?? []).filter((row) => {
    const createdAt = (row as { created_at?: string }).created_at;
    if (!createdAt) return false;
    return borrowReturnParisDateKey(new Date(createdAt).getTime()) === dayKey;
  }).length;
}
