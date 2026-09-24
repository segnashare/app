import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  declareSubscriptionCancelToN8n,
  periodEndIsoFromStripeSubscription,
} from "@/lib/notifications/notify-ops-activity-n8n";
import { notifySubscriptionCancelImmediate } from "@/lib/notifications/subscription-cancel-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import {
  getMappedPlanCodeFromSubscription,
  markSubscriptionCanceledLocally,
  upsertSubscriptionAndEntitlements,
} from "@/lib/stripe/subscription-state";
import { applySubscriptionCancelAtPeriodEndEffects } from "@/lib/subscription/apply-cancel-at-period-end-effects";
import { refundLatestSubscriptionInvoiceIfNeeded } from "@/lib/stripe/refund-subscription-latest-invoice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { forfeitWalletOnImmediateSubscriptionCancel } from "@/lib/wallet/forfeit-wallet-on-immediate-subscription-cancel";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Sub / customer introuvable sur ce compte Stripe (test≠live, cancel manuel, etc.). */
function isStripeResourceMissing(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    (error.code === "resource_missing" || error.statusCode === 404)
  );
}

async function applyStripeCancel(
  stripe: Stripe,
  subscriptionId: string,
  mode: "immediate" | "at_period_end",
): Promise<Stripe.Subscription> {
  if (mode === "immediate") {
    return stripe.subscriptions.cancel(subscriptionId, { prorate: false });
  }
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

async function notifyBackofficeCancelSideEffects(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    userId: string;
    subscriptionId: string;
    mode: "immediate" | "at_period_end";
    periodEndIso: string | null;
    planCode: string | null;
    subscription: Stripe.Subscription | null;
  },
): Promise<void> {
  if (input.mode === "at_period_end" && input.subscription) {
    try {
      await applySubscriptionCancelAtPeriodEndEffects(admin, input.userId, input.subscription, {
        notify: true,
      });
    } catch (e) {
      console.error("[internal/backoffice-cancel-subscription] cancel-at-period-end effects", e);
    }
    return;
  }

  if (input.mode === "at_period_end") {
    try {
      await declareSubscriptionCancelToN8n(admin, {
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        periodEndIso: input.periodEndIso,
        mode: "at_period_end",
        planCode: input.planCode,
        source: "backoffice",
      });
    } catch (e) {
      console.error("[internal/backoffice-cancel-subscription] declare cancel n8n scheduled", e);
    }
    return;
  }

  await forfeitWalletOnImmediateSubscriptionCancel(admin, {
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    source: "backoffice",
  });
  try {
    await notifySubscriptionCancelImmediate(admin, {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
    });
  } catch (e) {
    console.error("[internal/backoffice-cancel-subscription] notify immediate", e);
  }
  try {
    await declareSubscriptionCancelToN8n(admin, {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      periodEndIso: input.periodEndIso,
      mode: "immediate",
      planCode: input.planCode,
      source: "backoffice",
    });
  } catch (e) {
    console.error("[internal/backoffice-cancel-subscription] declare cancel n8n immediate", e);
  }
}

function forfeitFailedResponse(error: unknown) {
  const detail = error instanceof Error ? error.message : "wallet_forfeit_failed";
  console.error("[internal/backoffice-cancel-subscription] wallet forfeit FAILED", detail);
  return NextResponse.json(
    {
      ok: false as const,
      error: "wallet_forfeit_failed",
      detail,
      canceled: true as const,
    },
    { status: 500 },
  );
}

function refundFailedResponse(detail: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: "refund_failed",
      detail,
      canceled: true as const,
      forfeited: true as const,
    },
    { status: 502 },
  );
}

async function runCancelSideEffects(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: Parameters<typeof notifyBackofficeCancelSideEffects>[1],
): Promise<NextResponse | null> {
  try {
    await notifyBackofficeCancelSideEffects(admin, input);
    return null;
  } catch (error) {
    return forfeitFailedResponse(error);
  }
}

async function refundCanceledSubscription(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<{ refunded: boolean; refundId?: string; error?: string }> {
  try {
    const result = await refundLatestSubscriptionInvoiceIfNeeded({ stripe, subscription });
    if (!result.ok) return { refunded: false, error: result.error };
    return { refunded: result.didRefund, refundId: result.refundId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "refund_failed";
    console.error("[internal/backoffice-cancel-subscription] refund threw", detail);
    return { refunded: false, error: detail };
  }
}

async function refundBySubscriptionId(
  stripe: Stripe,
  subscriptionId: string,
): Promise<{ refunded: boolean; refundId?: string; error?: string }> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return refundCanceledSubscription(stripe, subscription);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "refund_failed";
    return { refunded: false, error: detail };
  }
}

function internalBackofficeSecrets(): string[] {
  const dedicated = process.env.SEGNA_INTERNAL_BACKOFFICE_CART_CANCEL_SECRET?.trim() ?? "";
  const ship = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const uber = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([dedicated, ship, uber].filter(Boolean))];
}

/**
 * Annulation d’abonnement depuis le back-office.
 *
 * Auth : mêmes secrets que `backoffice-cancel-cart-order-pending`.
 * Body : `{ user_id, mode?: "at_period_end" | "immediate", refund?: boolean, actor_user_id? }`
 */
export async function POST(request: Request) {
  const candidates = internalBackofficeSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { user_id?: unknown; mode?: unknown; refund?: unknown; actor_user_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!isUuid(userId)) {
    return NextResponse.json({ ok: false as const, error: "user_id_invalid" }, { status: 400 });
  }

  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "at_period_end";
  const mode = modeRaw === "immediate" ? "immediate" : "at_period_end";
  const refund = mode === "immediate" && body.refund === true;

  const admin = createSupabaseAdminClient() as any;

  const { data: subRow, error: subErr } = await admin
    .from("user_subscriptions")
    .select("provider_subscription_id, provider_customer_id, plan_code, status, cancel_at_period_end")
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    return NextResponse.json({ ok: false as const, error: "subscription_read_failed", detail: subErr.message }, { status: 500 });
  }

  const subscriptionId =
    typeof subRow?.provider_subscription_id === "string" ? subRow.provider_subscription_id.trim() : "";
  if (!subscriptionId) {
    return NextResponse.json({ ok: false as const, error: "subscription_not_found" }, { status: 404 });
  }

  const status = String(subRow?.status ?? "").toLowerCase();
  if (status === "canceled" || status === "incomplete_expired") {
    if (mode === "immediate") {
      const fail = await runCancelSideEffects(admin, {
        userId,
        subscriptionId,
        mode,
        periodEndIso: null,
        planCode: typeof subRow?.plan_code === "string" ? subRow.plan_code : null,
        subscription: null,
      });
      if (fail) return fail;
      if (refund) {
        const { secretKey } = getStripeConfig();
        const stripe = new Stripe(secretKey);
        const refundResult = await refundBySubscriptionId(stripe, subscriptionId);
        if (refundResult.error) return refundFailedResponse(refundResult.error);
        return NextResponse.json({
          ok: true as const,
          skipped: true as const,
          reason: "already_canceled",
          refunded: refundResult.refunded,
          refund_id: refundResult.refundId ?? null,
        });
      }
    }
    return NextResponse.json({ ok: true as const, skipped: true as const, reason: "already_canceled" });
  }

  if (mode === "at_period_end" && Boolean(subRow?.cancel_at_period_end)) {
    return NextResponse.json({ ok: true as const, skipped: true as const, reason: "already_cancel_at_period_end" });
  }

  const customerIdFromDb =
    typeof subRow?.provider_customer_id === "string" ? subRow.provider_customer_id.trim() : "";

  try {
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);

    let subscription: Stripe.Subscription;
    let syncedFrom: "stored" | "already_canceled" | "other_live" | "local_missing" = "stored";

    try {
      subscription = await applyStripeCancel(stripe, subscriptionId, mode);
    } catch (primaryError) {
      // Abonnement déjà annulé / inexistant côté Stripe (ex. cancel manuel dashboard) :
      // on resynchronise la DB au lieu de bloquer le BO.
      try {
        const existing = await stripe.subscriptions.retrieve(subscriptionId);
        if (existing.status === "canceled" || existing.status === "incomplete_expired") {
          subscription = existing;
          syncedFrom = "already_canceled";
        } else if (mode === "at_period_end" && existing.cancel_at_period_end) {
          subscription = existing;
          syncedFrom = "already_canceled";
        } else {
          throw primaryError;
        }
      } catch (retrieveError) {
        if (!isStripeResourceMissing(retrieveError) && !isStripeResourceMissing(primaryError)) {
          throw primaryError;
        }

        const localMissingResponse = async (customerId: string) => {
          await markSubscriptionCanceledLocally(admin, userId, customerId, subscriptionId);
          const fail = await runCancelSideEffects(admin, {
            userId,
            subscriptionId,
            mode,
            periodEndIso: null,
            planCode: typeof subRow?.plan_code === "string" ? subRow.plan_code : null,
            subscription: null,
          });
          if (fail) return fail;
          if (refund) {
            const refundResult = await refundBySubscriptionId(stripe, subscriptionId);
            if (refundResult.error) return refundFailedResponse(refundResult.error);
            return NextResponse.json({
              ok: true as const,
              mode,
              status: "canceled",
              cancel_at_period_end: false,
              plan_code: "guest",
              synced_from: "local_missing" as const,
              refunded: refundResult.refunded,
              refund_id: refundResult.refundId ?? null,
            });
          }
          return NextResponse.json({
            ok: true as const,
            mode,
            status: "canceled",
            cancel_at_period_end: false,
            plan_code: "guest",
            synced_from: "local_missing" as const,
            refunded: false,
          });
        };

        const customerId = customerIdFromDb;
        if (!customerId) {
          return localMissingResponse("");
        }

        let list: Stripe.ApiList<Stripe.Subscription>;
        try {
          list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 30 });
        } catch (listError) {
          // Customer inexistant sur ce compte Stripe (souvent test vs live).
          if (isStripeResourceMissing(listError)) {
            return localMissingResponse(customerId);
          }
          throw listError;
        }

        const live = list.data
          .filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
          .sort((a, b) => b.created - a.created);

        if (live.length === 0) {
          return localMissingResponse(customerId);
        }

        let last: Stripe.Subscription | null = null;
        for (const liveSub of live) {
          last = await applyStripeCancel(stripe, liveSub.id, mode);
        }
        subscription = last!;
        syncedFrom = "other_live";
      }
    }

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : customerIdFromDb || null;

    await upsertSubscriptionAndEntitlements(admin, userId, customerId, subscription);

    const fail = await runCancelSideEffects(admin, {
      userId,
      subscriptionId: subscription.id,
      mode,
      periodEndIso: periodEndIsoFromStripeSubscription(subscription),
      planCode:
        (typeof subRow?.plan_code === "string" && subRow.plan_code) ||
        (await getMappedPlanCodeFromSubscription(admin, subscription)),
      subscription,
    });
    if (fail) return fail;

    let refunded = false;
    let refundId: string | undefined;
    if (refund) {
      const refundResult = await refundCanceledSubscription(stripe, subscription);
      if (refundResult.error) return refundFailedResponse(refundResult.error);
      refunded = refundResult.refunded;
      refundId = refundResult.refundId;
    }

    return NextResponse.json({
      ok: true as const,
      mode,
      status: subscription.status,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      plan_code: subRow?.plan_code ?? null,
      synced_from: syncedFrom,
      refunded,
      refund_id: refundId ?? null,
    });
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      await markSubscriptionCanceledLocally(admin, userId, customerIdFromDb, subscriptionId);
      const fail = await runCancelSideEffects(admin, {
        userId,
        subscriptionId,
        mode,
        periodEndIso: null,
        planCode: typeof subRow?.plan_code === "string" ? subRow.plan_code : null,
        subscription: null,
      });
      if (fail) return fail;
      return NextResponse.json({
        ok: true as const,
        mode,
        status: "canceled",
        cancel_at_period_end: false,
        plan_code: "guest",
        synced_from: "local_missing" as const,
        refunded: false,
      });
    }
    const message = error instanceof Error ? error.message : "stripe_cancel_failed";
    console.error("[internal/backoffice-cancel-subscription]", message);
    return NextResponse.json({ ok: false as const, error: "stripe_cancel_failed", detail: message }, { status: 502 });
  }
}
