import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { formatLongDateParis } from "@/lib/datetime/segna-datetime";
import {
  claimNotificationSend,
  releaseNotificationSend,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  postOpsActivityN8nWebhook,
  type OpsActivityN8nResult,
} from "@/lib/notifications/n8n-ops-activity-webhook";
import { getMappedPlanCodeFromSubscription } from "@/lib/stripe/subscription-state";

export type OpsActivityN8nNotifyResult =
  | { ok: true; skipped?: boolean }
  | OpsActivityN8nResult
  | { ok: false; reason: "user_not_found"; detail?: string };

type UserContact = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

async function loadUserContact(admin: SupabaseClient, userId: string): Promise<UserContact | null> {
  const { data, error } = await admin
    .from("users")
    .select("email, first_name, last_name, phone")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[n8n/ops-activity] loadUserContact", error.message);
    return null;
  }
  return data as UserContact | null;
}

function userFields(user: UserContact | null) {
  return {
    user_email: user?.email?.trim() ?? null,
    user_first_name: user?.first_name?.trim() ?? null,
    user_last_name: user?.last_name?.trim() ?? null,
    user_phone: user?.phone?.trim() ?? null,
  };
}

/**
 * Nouveau compte membre réel (`public.users` via bootstrap).
 * Idempotent : une déclaration par `user_id`.
 */
export async function declareUserRegisteredToN8n(
  admin: SupabaseClient,
  input: { userId: string; source?: string },
): Promise<OpsActivityN8nNotifyResult> {
  const idempotencyKey = `txn:user_registered_n8n:${input.userId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.userRegisteredN8nDeclared,
    userId: input.userId,
    metadata: { source: input.source ?? null },
  });
  if (!claimed) {
    return { ok: true, skipped: true };
  }

  const user = await loadUserContact(admin, input.userId);
  if (!user) {
    await releaseNotificationSend(admin, idempotencyKey);
    return { ok: false, reason: "user_not_found" };
  }

  const result = await postOpsActivityN8nWebhook(
    {
      event: "user_registered",
      user_id: input.userId,
      ...userFields(user),
      source: input.source ?? null,
      registered_at: new Date().toISOString(),
    },
    "user-registered",
  );
  if (!result.ok) {
    await releaseNotificationSend(admin, idempotencyKey);
  }
  return result;
}

function planLabel(code: string | null | undefined): string {
  if (code === "segna_x") return "Segna X";
  if (code === "segna_plus") return "Segna+";
  return code?.trim() || "abonnement";
}

function displayName(user: UserContact | null): string {
  const n = [user?.first_name?.trim(), user?.last_name?.trim()].filter(Boolean).join(" ");
  return n || user?.email?.trim() || "Membre";
}

export function periodEndIsoFromStripeSubscription(subscription: Stripe.Subscription): string | null {
  const firstItem = subscription.items.data[0];
  const unix = firstItem?.current_period_end ?? null;
  if (!unix || unix <= 0) return null;
  return new Date(unix * 1000).toISOString();
}

/**
 * Abonnement actif / essai (Stripe). Idempotent par `subscription.id`.
 */
export async function declareSubscriptionActivatedToN8n(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
): Promise<OpsActivityN8nNotifyResult> {
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return { ok: true, skipped: true };
  }

  const idempotencyKey = `txn:subscription_activated_n8n:${subscription.id}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionActivatedN8nDeclared,
    userId,
    metadata: {
      stripe_subscription_id: subscription.id,
      status: subscription.status,
    },
  });
  if (!claimed) {
    return { ok: true, skipped: true };
  }

  const user = await loadUserContact(admin, userId);
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  const name = displayName(user);
  const plan = planLabel(planCode);
  const discordContent = `🎉 Nouvel abonné — ${name} (${plan})`;

  const result = await postOpsActivityN8nWebhook(
    {
      event: "subscription_activated",
      user_id: userId,
      ...userFields(user),
      stripe_subscription_id: subscription.id,
      plan_code: planCode,
      status: subscription.status,
      activated_at: new Date().toISOString(),
      discord_content: discordContent,
      discord_title: "Nouvel abonné",
      discord_description: `${name} — ${plan} (${subscription.status})`,
    },
    "subscription-activated",
  );
  if (!result.ok) {
    await releaseNotificationSend(admin, idempotencyKey);
  }
  return result;
}

export type SubscriptionCancelN8nMode = "at_period_end" | "immediate";

/**
 * Résiliation (fin de période ou immédiate). Idempotent par `subscription.id` + mode.
 * Si une résiliation fin de période a déjà été déclarée, l’événement « immédiat »
 * (fin naturelle de période) est ignoré pour éviter un second ping Discord.
 */
export async function declareSubscriptionCancelToN8n(
  admin: SupabaseClient,
  input: {
    userId: string;
    subscriptionId: string;
    periodEndIso: string | null;
    mode: SubscriptionCancelN8nMode;
    planCode?: string | null;
    source?: string;
  },
): Promise<OpsActivityN8nNotifyResult> {
  if (input.mode === "immediate") {
    const { data: alreadyScheduled } = await admin
      .from("notification_send_log")
      .select("idempotency_key")
      .eq("idempotency_key", `txn:subscription_cancel_n8n:${input.subscriptionId}:at_period_end`)
      .maybeSingle();
    if (alreadyScheduled) {
      return { ok: true, skipped: true };
    }
  }

  const idempotencyKey = `txn:subscription_cancel_n8n:${input.subscriptionId}:${input.mode}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionCancelN8nDeclared,
    userId: input.userId,
    metadata: {
      stripe_subscription_id: input.subscriptionId,
      mode: input.mode,
      period_end: input.periodEndIso,
      source: input.source ?? null,
    },
  });
  if (!claimed) {
    return { ok: true, skipped: true };
  }

  const user = await loadUserContact(admin, input.userId);
  const name = displayName(user);
  const plan = planLabel(input.planCode);
  const periodEndLabel = input.periodEndIso ? formatLongDateParis(input.periodEndIso) : null;
  const isScheduled = input.mode === "at_period_end";
  const discordContent = isScheduled
    ? `📉 Résiliation fin de période — ${name} (${plan}) jusqu’au ${periodEndLabel ?? "—"}`
    : `📉 Résiliation immédiate — ${name} (${plan})`;

  const result = await postOpsActivityN8nWebhook(
    {
      event: isScheduled ? "subscription_cancel_scheduled" : "subscription_canceled",
      user_id: input.userId,
      ...userFields(user),
      stripe_subscription_id: input.subscriptionId,
      plan_code: input.planCode ?? null,
      period_end: input.periodEndIso,
      period_end_label: periodEndLabel,
      cancel_mode: input.mode,
      source: input.source ?? null,
      canceled_at: new Date().toISOString(),
      discord_content: discordContent,
      discord_title: isScheduled ? "Résiliation — fin de période" : "Résiliation immédiate",
      discord_description: isScheduled
        ? `${name} — ${plan} — accès jusqu’au ${periodEndLabel ?? "—"}`
        : `${name} — ${plan} — accès arrêté`,
    },
    "subscription-cancel",
  );
  if (!result.ok) {
    await releaseNotificationSend(admin, idempotencyKey);
  }
  return result;
}
