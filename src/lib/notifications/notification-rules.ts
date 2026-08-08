import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimNotificationSend,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import {
  allowsMarketingPush,
  loadMemberCommsPreferences,
} from "@/lib/notifications/member-comms-preferences";
import { buildMemberPushData, sendExpoPushToUser } from "@/lib/notifications/expo-push-send";

export const LIKED_ITEM_AVAILABLE_TRIGGER = "liked_item_available";

export type NotificationRuleConditionValue = {
  id: string;
  enabled: boolean;
  delayMinutes?: number;
};

export type NotificationAudienceConfig = {
  combine: "and" | "or";
  periodValue: number;
  periodUnit: "minutes" | "hours" | "days";
  predicates: Array<{ atomId: string }>;
};

export type NotificationRuleRow = {
  id: string;
  label: string;
  trigger_event: string;
  title_template: string;
  body_template: string;
  channels: string[] | null;
  conditions: NotificationRuleConditionValue[] | null;
  audience: NotificationAudienceConfig | Record<string, unknown> | null;
  send_delay_minutes: number | null;
  enabled: boolean;
};

function parseAudience(raw: unknown): NotificationAudienceConfig {
  const fallback: NotificationAudienceConfig = {
    combine: "and",
    periodValue: 30,
    periodUnit: "days",
    predicates: [
      { atomId: "event:item_liked" },
      { atomId: "status:item_liked" },
      { atomId: "status:exclude_item_owner" },
    ],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  const combine = o.combine === "or" ? "or" : "and";
  const periodUnit =
    o.periodUnit === "minutes" || o.periodUnit === "hours" || o.periodUnit === "days"
      ? o.periodUnit
      : "days";
  const periodValue =
    typeof o.periodValue === "number" && Number.isFinite(o.periodValue)
      ? Math.max(1, Math.floor(o.periodValue))
      : 30;
  const predicates = Array.isArray(o.predicates)
    ? o.predicates
        .map((p) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) return null;
          const atomId = (p as { atomId?: unknown }).atomId;
          return typeof atomId === "string" && atomId ? { atomId } : null;
        })
        .filter((p): p is { atomId: string } => Boolean(p))
    : [];
  return {
    combine,
    periodValue,
    periodUnit,
    predicates: predicates.length ? predicates : fallback.predicates,
  };
}

function audiencePeriodMs(audience: NotificationAudienceConfig): number {
  const n = Math.max(1, audience.periodValue);
  if (audience.periodUnit === "minutes") return n * 60_000;
  if (audience.periodUnit === "hours") return n * 3_600_000;
  return n * 86_400_000;
}

type UserContactVars = {
  prenom: string;
  nom: string;
  email: string;
};

export function kindForNotificationRule(ruleId: string): string {
  return `rule:${ruleId}`;
}

export function isNotificationRuleKind(kind: string): boolean {
  return kind.startsWith("rule:");
}

/** Remplace `{nom_item}`, `{prenom}`, … (insensible à la casse des clés). */
export function renderNotificationTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const hit = Object.entries(vars).find(([k]) => k.toLowerCase() === key);
    return hit?.[1] ?? "";
  });
}

function sendDelayMinutes(rule: NotificationRuleRow): number {
  const n = rule.send_delay_minutes;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

async function loadEnabledRules(
  admin: SupabaseClient,
  triggerEvent: string,
): Promise<NotificationRuleRow[]> {
  const { data, error } = await admin
    .from("notification_rules")
    .select(
      "id,label,trigger_event,title_template,body_template,channels,conditions,audience,send_delay_minutes,enabled",
    )
    .eq("trigger_event", triggerEvent)
    .eq("enabled", true)
    .is("deleted_at", null);
  if (error) {
    console.error("[notifications] loadEnabledRules", error.message);
    return [];
  }
  return (data ?? []) as NotificationRuleRow[];
}

async function loadUserContactVars(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, UserContactVars>> {
  const out = new Map<string, UserContactVars>();
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    const { data: users } = await admin
      .from("users")
      .select("id,first_name,last_name,email")
      .in("id", chunk);
    for (const u of users ?? []) {
      const row = u as {
        id?: string;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      };
      if (!row.id) continue;
      out.set(row.id, {
        prenom: typeof row.first_name === "string" ? row.first_name.trim() : "",
        nom: typeof row.last_name === "string" ? row.last_name.trim() : "",
        email: typeof row.email === "string" ? row.email.trim() : "",
      });
    }
  }
  return out;
}

async function sendRulePush(
  admin: SupabaseClient,
  input: {
    userId: string;
    rule: NotificationRuleRow;
    title: string;
    body: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const kind = kindForNotificationRule(input.rule.id);
  const prefs = await loadMemberCommsPreferences(admin, input.userId);
  if (!allowsMarketingPush(prefs, kind)) return;

  const claimed = await claimNotificationSend(admin, {
    idempotencyKey: input.idempotencyKey,
    kind,
    userId: input.userId,
    metadata: {
      ...input.metadata,
      title: input.title,
      body: input.body,
      rule_id: input.rule.id,
      rule_label: input.rule.label,
      trigger_event: input.rule.trigger_event,
    },
  });
  if (!claimed) return;

  try {
    const ok = await sendExpoPushToUser(admin, input.userId, {
      title: input.title,
      body: input.body,
      data: buildMemberPushData({ kind, metadata: input.metadata }),
    });
    if (!ok) {
      await releaseNotificationSend(admin, input.idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, input.idempotencyKey, "push");
  } catch (e) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] sendRulePush failed", msg);
  }
}

async function enqueueOrSend(
  admin: SupabaseClient,
  input: {
    rule: NotificationRuleRow;
    userId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
    preflight?: () => Promise<boolean>;
  },
): Promise<void> {
  const delayMin = sendDelayMinutes(input.rule);
  if (delayMin <= 0) {
    if (input.preflight && !(await input.preflight())) return;
    await sendRulePush(admin, {
      userId: input.userId,
      rule: input.rule,
      title: input.title,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return;
  }

  const sendAt = new Date(Date.now() + delayMin * 60_000).toISOString();
  const { error } = await admin.from("notification_rule_queue").upsert(
    {
      rule_id: input.rule.id,
      user_id: input.userId,
      idempotency_key: input.idempotencyKey,
      payload: {
        ...input.payload,
        title: input.title,
        body: input.body,
        metadata: input.metadata,
      },
      send_at: sendAt,
      canceled_at: null,
      sent_at: null,
    },
    { onConflict: "idempotency_key" },
  );
  if (error) {
    console.error("[notifications] enqueue rule", error.message);
  }
}

type FavoriteRow = {
  user_id: string;
  created_at: string | null;
  deleted_at: string | null;
};

async function evaluateAudienceForItemUser(
  admin: SupabaseClient,
  input: {
    audience: NotificationAudienceConfig;
    userId: string;
    itemId: string;
    ownerUserId?: string | null;
    favorite: FavoriteRow | null;
  },
): Promise<boolean> {
  const sinceMs = Date.now() - audiencePeriodMs(input.audience);
  const results: boolean[] = [];

  for (const pred of input.audience.predicates) {
    const atomId = pred.atomId;
    let ok = true;

    if (atomId === "status:item_liked") {
      ok = Boolean(input.favorite && !input.favorite.deleted_at);
    } else if (atomId === "event:item_liked") {
      const created = input.favorite?.created_at
        ? new Date(input.favorite.created_at).getTime()
        : NaN;
      ok = Number.isFinite(created) && created >= sinceMs;
    } else if (atomId === "event:item_unliked") {
      const deleted = input.favorite?.deleted_at
        ? new Date(input.favorite.deleted_at).getTime()
        : NaN;
      ok = Number.isFinite(deleted) && deleted >= sinceMs;
    } else if (atomId === "status:exclude_item_owner") {
      ok = input.userId !== input.ownerUserId;
    } else if (atomId === "status:has_push_token") {
      const { count } = await admin
        .from("device_push_tokens")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.userId)
        .is("disabled_at", null);
      ok = (count ?? 0) > 0;
    } else {
      // Atoms non évaluables sur ce déclencheur : on ignore (passent).
      ok = true;
    }
    results.push(ok);
  }

  if (results.length === 0) return true;
  return input.audience.combine === "or" ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Notifie selon les règles BO `liked_item_available` + audience libre (events/status ∩/∪).
 */
export async function dispatchLikedItemAvailableRules(
  admin: SupabaseClient,
  input: { itemId: string; itemLabel: string; ownerUserId?: string | null },
): Promise<void> {
  const rules = await loadEnabledRules(admin, LIKED_ITEM_AVAILABLE_TRIGGER);
  if (rules.length === 0) return;

  const { data: favorites, error: favErr } = await admin
    .from("item_favorites")
    .select("user_id,created_at,deleted_at")
    .eq("item_id", input.itemId);
  if (favErr) {
    console.error("[notifications] item_favorites", favErr.message);
    return;
  }

  const favByUser = new Map<string, FavoriteRow>();
  for (const row of favorites ?? []) {
    const r = row as FavoriteRow;
    if (!r.user_id) continue;
    favByUser.set(r.user_id, r);
  }
  const candidateIds = [...favByUser.keys()];
  if (candidateIds.length === 0) return;

  const contactByUser = await loadUserContactVars(admin, candidateIds);

  for (const rule of rules) {
    const wantsPush = !rule.channels?.length || rule.channels.includes("push");
    if (!wantsPush) continue;

    const audience = parseAudience(rule.audience);
    const recipients: string[] = [];
    for (const userId of candidateIds) {
      const pass = await evaluateAudienceForItemUser(admin, {
        audience,
        userId,
        itemId: input.itemId,
        ownerUserId: input.ownerUserId,
        favorite: favByUser.get(userId) ?? null,
      });
      if (pass) recipients.push(userId);
    }

    for (const userId of recipients) {
      const contact = contactByUser.get(userId) ?? { prenom: "", nom: "", email: "" };
      const vars = {
        nom_item: input.itemLabel,
        item_id: input.itemId,
        prenom: contact.prenom,
        nom: contact.nom,
        email: contact.email,
      };
      const title = renderNotificationTemplate(rule.title_template, vars).trim().slice(0, 80) || "Segna";
      const body = renderNotificationTemplate(rule.body_template, vars).trim().slice(0, 240);
      if (!body) continue;

      await enqueueOrSend(admin, {
        rule,
        userId,
        idempotencyKey: `rule:${rule.id}:liked_available:${input.itemId}:${userId}`,
        payload: {
          trigger: LIKED_ITEM_AVAILABLE_TRIGGER,
          item_id: input.itemId,
          item_label: input.itemLabel,
          owner_user_id: input.ownerUserId ?? null,
        },
        title,
        body,
        metadata: {
          item_id: input.itemId,
          event: LIKED_ITEM_AVAILABLE_TRIGGER,
        },
        preflight: async () =>
          evaluateAudienceForItemUser(admin, {
            audience,
            userId,
            itemId: input.itemId,
            ownerUserId: input.ownerUserId,
            favorite: favByUser.get(userId) ?? null,
          }),
      });
    }
  }
}

/**
 * Traite la file des envois différés (cron).
 */
export async function processNotificationRuleQueue(
  admin: SupabaseClient,
  limit = 80,
): Promise<{ processed: number; sent: number; skipped: number }> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("notification_rule_queue")
    .select("id,rule_id,user_id,idempotency_key,payload")
    .is("sent_at", null)
    .is("canceled_at", null)
    .lte("send_at", nowIso)
    .order("send_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[notifications] process queue", error.message);
    return { processed: 0, sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;

  for (const raw of rows ?? []) {
    const row = raw as {
      id: string;
      rule_id: string;
      user_id: string;
      idempotency_key: string;
      payload: Record<string, unknown> | null;
    };
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};

    const { data: ruleData } = await admin
      .from("notification_rules")
      .select(
        "id,label,trigger_event,title_template,body_template,channels,conditions,audience,send_delay_minutes,enabled,deleted_at",
      )
      .eq("id", row.rule_id)
      .maybeSingle();

    const rule = ruleData as (NotificationRuleRow & { deleted_at?: string | null }) | null;
    if (!rule || rule.deleted_at || !rule.enabled) {
      await admin
        .from("notification_rule_queue")
        .update({ canceled_at: nowIso })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }

    // Re-check audience for liked_item_available.
    if (rule.trigger_event === LIKED_ITEM_AVAILABLE_TRIGGER) {
      const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
      const ownerUserId =
        typeof payload.owner_user_id === "string" ? payload.owner_user_id : null;
      if (itemId) {
        const { data: fav } = await admin
          .from("item_favorites")
          .select("user_id,created_at,deleted_at")
          .eq("item_id", itemId)
          .eq("user_id", row.user_id)
          .maybeSingle();
        const ok = await evaluateAudienceForItemUser(admin, {
          audience: parseAudience(rule.audience),
          userId: row.user_id,
          itemId,
          ownerUserId,
          favorite: (fav as FavoriteRow | null) ?? null,
        });
        if (!ok) {
          await admin
            .from("notification_rule_queue")
            .update({ canceled_at: nowIso })
            .eq("id", row.id);
          skipped += 1;
          continue;
        }
      }
    }

    const title =
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 80)
        : "Segna";
    const body = typeof payload.body === "string" ? payload.body.trim().slice(0, 240) : "";
    const metadata =
      payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {};

    if (!body) {
      await admin
        .from("notification_rule_queue")
        .update({ canceled_at: nowIso })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }

    await sendRulePush(admin, {
      userId: row.user_id,
      rule,
      title,
      body,
      idempotencyKey: row.idempotency_key,
      metadata,
    });

    await admin
      .from("notification_rule_queue")
      .update({ sent_at: nowIso })
      .eq("id", row.id);
    sent += 1;
  }

  return { processed: (rows ?? []).length, sent, skipped };
}
