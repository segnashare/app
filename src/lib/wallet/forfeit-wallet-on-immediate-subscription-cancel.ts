import type { SupabaseClient } from "@supabase/supabase-js";

export type ForfeitWalletResult = {
  ok: true;
  skipped?: boolean;
  reason?: string;
  wallet_id?: string;
  forfeited_consumption_points?: number;
  forfeited_exchange_points?: number;
};

const MAX_ATTEMPTS = 3;

function scheduledCancelHasReachedPeriodEnd(periodEndIso: string | null | undefined): boolean {
  if (!periodEndIso) return false;
  const t = new Date(periodEndIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + 2 * 60 * 1000;
}

function periodEndFromLogMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { period_end?: unknown }).period_end;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Passe le wallet à zéro après une résiliation immédiate.
 * Idempotent via `subscription_cancel_forfeit:{subscriptionId}:…`.
 * `skipIfScheduled` : ne rien faire si une annulation fin de période a déjà été notifiée
 * **et** que la date de fin est atteinte (évite de zéroter à l’échéance).
 * Une résiliation immédiate après un « fin de période » (date encore future) zérote bien.
 */
export async function forfeitWalletOnImmediateSubscriptionCancel(
  admin: SupabaseClient,
  input: {
    userId: string;
    subscriptionId: string;
    source?: string;
    skipIfScheduled?: boolean;
    periodEndIso?: string | null;
  },
): Promise<ForfeitWalletResult> {
  const subscriptionId = input.subscriptionId.trim();
  if (!input.userId || !subscriptionId) {
    throw new Error("forfeit_wallet_missing_ids");
  }

  if (input.skipIfScheduled) {
    const { data: alreadyScheduled } = await admin
      .from("notification_send_log")
      .select("idempotency_key, metadata")
      .eq("idempotency_key", `txn:subscription_cancel_scheduled:${subscriptionId}`)
      .maybeSingle();
    if (alreadyScheduled) {
      const periodEnd = input.periodEndIso ?? periodEndFromLogMetadata(alreadyScheduled.metadata);
      if (scheduledCancelHasReachedPeriodEnd(periodEnd)) {
        console.info(
          "[wallet] forfeit skipped: scheduled cancel reached period end",
          subscriptionId,
          periodEnd,
        );
        return { ok: true, skipped: true, reason: "scheduled_cancel" };
      }
      console.info(
        "[wallet] forfeit running: immediate cancel after scheduled (period still future)",
        subscriptionId,
        periodEnd,
      );
    }
  }

  let lastMessage = "wallet_forfeit_failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await (admin as any).rpc("wallet_forfeit_on_immediate_subscription_cancel", {
      p_user_id: input.userId,
      p_subscription_id: subscriptionId,
      p_source: input.source ?? "immediate_cancel",
    });
    if (!error) {
      const result = (data ?? { ok: true }) as ForfeitWalletResult;
      console.info("[wallet] forfeit on immediate cancel", {
        userId: input.userId,
        subscriptionId,
        source: input.source ?? "immediate_cancel",
        attempt,
        skipped: Boolean(result.skipped),
        reason: result.reason ?? null,
        forfeited_consumption_points: result.forfeited_consumption_points ?? null,
        forfeited_exchange_points: result.forfeited_exchange_points ?? null,
      });
      return { ...result, ok: true };
    }
    lastMessage = error.message || "wallet_forfeit_failed";
    console.error("[wallet] forfeit RPC failed", {
      userId: input.userId,
      subscriptionId,
      source: input.source ?? "immediate_cancel",
      attempt,
      message: lastMessage,
    });
  }

  throw new Error(lastMessage);
}
