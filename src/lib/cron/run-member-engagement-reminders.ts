import type { SupabaseClient } from "@supabase/supabase-js";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import {
  getMemberEngagementReminderConfig,
  type MemberEngagementReminderConfig,
} from "@/lib/cron/member-engagement-reminder-config";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  buildAbandonedCartReminderSms,
  buildOnboardingIncompleteFollowupReminderSms,
  buildOnboardingIncompleteReminderSms,
} from "@/lib/notifications/member-engagement-reminder-sms";
import { sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";

export type EngagementReminderRunStats = {
  scanned: number;
  eligible: number;
  notifyCalls: number;
};

type UserRow = {
  id: string;
  created_at?: string;
  onboarding_process?: string | null;
  phone?: string | null;
};

function isOnboardingInAppFinished(process: string | null | undefined): boolean {
  return process === "finished";
}

function cartLineStillBorrowable(cartItemStatus: string | null, itemStatus: string | null): boolean {
  if (cartItemStatus === "in_cart" && (itemStatus === "available" || itemStatus === "in_cart")) return true;
  if (cartItemStatus === "reservation_pending" && itemStatus === "available") return true;
  return false;
}

async function fetchOnboardingIncompleteCandidates(
  admin: SupabaseClient,
  cfg: MemberEngagementReminderConfig,
  opts: { createdAtLte: string; createdAtGt?: string },
): Promise<UserRow[]> {
  let query = admin
    .from("users")
    .select("id, created_at, onboarding_process, phone")
    .eq("onboarding_mode", "real")
    .eq("status", "active")
    .is("deleted_at", null)
    .not("onboarding_completed_at", "is", null)
    .not("phone", "is", null)
    .lte("created_at", opts.createdAtLte)
    .or("onboarding_process.is.null,onboarding_process.neq.finished")
    .order("created_at", { ascending: true })
    .limit(cfg.maxCandidatesPerKind);

  if (opts.createdAtGt) {
    query = query.gt("created_at", opts.createdAtGt);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as UserRow[];
}

async function runOnboardingIncompleteReminders(
  admin: SupabaseClient,
  cfg: MemberEngagementReminderConfig,
  nowMs: number,
): Promise<EngagementReminderRunStats> {
  const firstMinIso = new Date(nowMs - cfg.onboardingFirstReminderMinAgeMs).toISOString();
  const followupMinIso = new Date(nowMs - cfg.onboardingFollowupMinAgeMs).toISOString();

  const rows = await fetchOnboardingIncompleteCandidates(admin, cfg, {
    createdAtLte: firstMinIso,
    createdAtGt: followupMinIso,
  });

  let scanned = 0;
  let eligible = 0;
  let notifyCalls = 0;

  for (const row of rows) {
    scanned++;
    if (!row.id || isOnboardingInAppFinished(row.onboarding_process)) continue;
    eligible++;
    await sendMemberSmsOnlyNotification(admin, {
      userId: row.id,
      kind: NotificationKind.onboardingIncompleteReminder,
      idempotencyKey: `eng:onboarding_incomplete:1:${row.id}`,
      metadata: { onboarding_process: row.onboarding_process ?? null, phase: "first" },
      smsBody: buildOnboardingIncompleteReminderSms(),
      applyCronSmsDailyCap: true,
      cronSmsNowMs: nowMs,
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

async function runOnboardingIncompleteFollowupReminders(
  admin: SupabaseClient,
  cfg: MemberEngagementReminderConfig,
  nowMs: number,
): Promise<EngagementReminderRunStats> {
  const followupMinIso = new Date(nowMs - cfg.onboardingFollowupMinAgeMs).toISOString();
  const rows = await fetchOnboardingIncompleteCandidates(admin, cfg, {
    createdAtLte: followupMinIso,
  });

  let scanned = 0;
  let eligible = 0;
  let notifyCalls = 0;

  for (const row of rows) {
    scanned++;
    if (!row.id || isOnboardingInAppFinished(row.onboarding_process)) continue;
    eligible++;
    await sendMemberSmsOnlyNotification(admin, {
      userId: row.id,
      kind: NotificationKind.onboardingIncompleteReminderFollowup,
      idempotencyKey: `eng:onboarding_incomplete:2:${row.id}`,
      metadata: { onboarding_process: row.onboarding_process ?? null, phase: "followup" },
      smsBody: buildOnboardingIncompleteFollowupReminderSms(),
      applyCronSmsDailyCap: true,
      cronSmsNowMs: nowMs,
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

export async function runMemberOnboardingReminders(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{
  onboardingIncompleteFirst: EngagementReminderRunStats;
  onboardingIncompleteFollowup: EngagementReminderRunStats;
}> {
  const cfg = getMemberEngagementReminderConfig();
  const onboardingIncompleteFirst = await runOnboardingIncompleteReminders(admin, cfg, nowMs);
  const onboardingIncompleteFollowup = await runOnboardingIncompleteFollowupReminders(admin, cfg, nowMs);
  return { onboardingIncompleteFirst, onboardingIncompleteFollowup };
}

export async function runAbandonedCartReminders(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<EngagementReminderRunStats> {
  const cfg = getMemberEngagementReminderConfig();
  const createdBeforeIso = new Date(nowMs - cfg.abandonedCartMinAgeMs).toISOString();

  const { data: carts, error: cErr } = await admin
    .from("carts")
    .select("id, user_id, created_at")
    .is("deleted_at", null)
    .in("status", [...CART_STATUSES_OPEN])
    .lte("created_at", createdBeforeIso)
    .order("created_at", { ascending: true })
    .limit(cfg.maxCandidatesPerKind);

  if (cErr) throw new Error(cErr.message);

  let scanned = 0;
  let eligible = 0;
  let notifyCalls = 0;

  for (const cart of carts ?? []) {
    const cartId = typeof (cart as { id?: string }).id === "string" ? (cart as { id: string }).id : "";
    const userId = typeof (cart as { user_id?: string }).user_id === "string" ? (cart as { user_id: string }).user_id : "";
    if (!cartId || !userId) continue;
    scanned++;

    const { data: userRow, error: uErr } = await admin
      .from("users")
      .select("id, phone")
      .eq("id", userId)
      .eq("onboarding_mode", "real")
      .eq("status", "active")
      .is("deleted_at", null)
      .not("phone", "is", null)
      .maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!userRow?.id) continue;

    const { data: lines, error: lErr } = await admin
      .from("cart_items")
      .select("status, items!inner(status)")
      .eq("cart_id", cartId)
      .is("deleted_at", null);
    if (lErr) throw new Error(lErr.message);

    const hasBorrowable = (lines ?? []).some((line) => {
      const row = line as { status?: string | null; items?: { status?: string | null } | { status?: string | null }[] };
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      return cartLineStillBorrowable(row.status ?? null, item?.status ?? null);
    });
    if (!hasBorrowable) continue;

    eligible++;
    await sendMemberSmsOnlyNotification(admin, {
      userId,
      kind: NotificationKind.abandonedCartReminder,
      idempotencyKey: `eng:abandoned_cart:${cartId}`,
      metadata: { cart_id: cartId, cart_created_at: (cart as { created_at?: string }).created_at ?? null },
      smsBody: buildAbandonedCartReminderSms(),
      applyCronSmsDailyCap: true,
      cronSmsNowMs: nowMs,
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

/** Agrégat legacy (tests manuels) — préférer les routes cron séparées. */
export async function runMemberEngagementReminders(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{
  onboardingIncompleteFirst: EngagementReminderRunStats;
  onboardingIncompleteFollowup: EngagementReminderRunStats;
  abandonedCart: EngagementReminderRunStats;
}> {
  const [onboarding, abandonedCart] = await Promise.all([
    runMemberOnboardingReminders(admin, nowMs),
    runAbandonedCartReminders(admin, nowMs),
  ]);
  return { ...onboarding, abandonedCart };
}
