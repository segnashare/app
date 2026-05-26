import type { SupabaseClient } from "@supabase/supabase-js";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import {
  getMemberEngagementReminderConfig,
  type MemberEngagementReminderConfig,
} from "@/lib/cron/member-engagement-reminder-config";
import { fetchMemberLastAppActivityMsByUserIds } from "@/lib/cron/member-last-app-activity";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";
import {
  buildAbandonedCartReminderSms,
  buildLikedItemsAvailableReminderSms,
  buildOnboardingIncompleteFollowupReminderSms,
  buildOnboardingIncompleteReminderSms,
  buildPieceSmsLabel,
} from "@/lib/notifications/member-engagement-reminder-sms";

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

/** 1er rappel : J+3 à J+9 (évite 2 SMS le jour du 2e rappel). */
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
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

/** 2e rappel : compte ≥ J+10, onboarding in-app toujours incomplet. */
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
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

type LikedFavoriteRow = {
  user_id?: string;
  created_at?: string;
  items?: {
    status?: string | null;
    title?: string | null;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | { label?: string | null }[] | null;
  } | null;
};

function resolveItemBrandLabel(row: LikedFavoriteRow["items"]): string | null {
  if (!row) return null;
  const custom = row.item_custom_brand_label?.trim();
  if (custom) return custom;
  const rel = row.item_brands;
  const brand = Array.isArray(rel) ? rel[0] : rel;
  const label = brand?.label?.trim();
  return label || null;
}

async function runLikedItemsAvailableReminders(
  admin: SupabaseClient,
  cfg: MemberEngagementReminderConfig,
  nowMs: number,
): Promise<EngagementReminderRunStats> {
  const inactiveBeforeMs = nowMs - cfg.likedItemsInactiveMs;

  const { data: favRows, error: favErr } = await admin
    .from("item_favorites")
    .select(
      "user_id, created_at, items!inner(status, title, item_custom_brand_label, item_brands(label))",
    )
    .is("deleted_at", null)
    .eq("items.status", "available")
    .order("created_at", { ascending: false })
    .limit(cfg.maxCandidatesPerKind * 12);

  if (favErr) throw new Error(favErr.message);

  const labelsByUser = new Map<string, string[]>();
  for (const row of (favRows ?? []) as LikedFavoriteRow[]) {
    const uid = typeof row.user_id === "string" ? row.user_id : "";
    if (!uid) continue;
    const item = row.items;
    if (!item || item.status !== "available") continue;
    const label = buildPieceSmsLabel(item.title, resolveItemBrandLabel(item));
    const prev = labelsByUser.get(uid) ?? [];
    if (prev.length >= 3) continue;
    if (prev.includes(label)) continue;
    labelsByUser.set(uid, [...prev, label]);
  }

  const candidateIds = [...labelsByUser.keys()].slice(0, cfg.maxCandidatesPerKind);
  if (candidateIds.length === 0) {
    return { scanned: 0, eligible: 0, notifyCalls: 0 };
  }

  const { data: users, error: uErr } = await admin
    .from("users")
    .select("id, phone")
    .in("id", candidateIds)
    .eq("onboarding_mode", "real")
    .eq("status", "active")
    .is("deleted_at", null)
    .not("phone", "is", null);
  if (uErr) throw new Error(uErr.message);

  const activeUserIds = (users ?? []).map((u) => (u as { id: string }).id).filter(Boolean);
  const lastActivityByUser = await fetchMemberLastAppActivityMsByUserIds(admin, activeUserIds);

  let scanned = 0;
  let eligible = 0;
  let notifyCalls = 0;

  for (const userId of activeUserIds) {
    scanned++;
    const lastMs = lastActivityByUser.get(userId);
    if (lastMs == null || lastMs > inactiveBeforeMs) continue;

    const pieceLabels = labelsByUser.get(userId) ?? [];
    const smsBody = buildLikedItemsAvailableReminderSms(pieceLabels);
    if (!smsBody) continue;

    eligible++;
    await sendMemberSmsOnlyNotification(admin, {
      userId,
      kind: NotificationKind.likedItemsAvailableReminder,
      idempotencyKey: `eng:liked_items_available:${userId}`,
      metadata: {
        last_activity_at: new Date(lastMs).toISOString(),
        piece_labels: pieceLabels,
      },
      smsBody,
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

async function runAbandonedCartReminders(
  admin: SupabaseClient,
  cfg: MemberEngagementReminderConfig,
  nowMs: number,
): Promise<EngagementReminderRunStats> {
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
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}

export type MemberEngagementRemindersResult = {
  onboardingIncompleteFirst: EngagementReminderRunStats;
  onboardingIncompleteFollowup: EngagementReminderRunStats;
  likedItemsAvailable: EngagementReminderRunStats;
  abandonedCart: EngagementReminderRunStats;
};

export async function runMemberEngagementReminders(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<MemberEngagementRemindersResult> {
  const cfg = getMemberEngagementReminderConfig();
  const [onboardingIncompleteFirst, onboardingIncompleteFollowup, likedItemsAvailable, abandonedCart] =
    await Promise.all([
      runOnboardingIncompleteReminders(admin, cfg, nowMs),
      runOnboardingIncompleteFollowupReminders(admin, cfg, nowMs),
      runLikedItemsAvailableReminders(admin, cfg, nowMs),
      runAbandonedCartReminders(admin, cfg, nowMs),
    ]);
  return { onboardingIncompleteFirst, onboardingIncompleteFollowup, likedItemsAvailable, abandonedCart };
}
