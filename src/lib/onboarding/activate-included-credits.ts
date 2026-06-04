import { fetchPlanEntitlementComparisonLimits } from "@/lib/billing/fetch-plan-entitlement-comparison-limits";

/** Une seule activation des crédits inclus Guest (étape onboarding « offer »). */
export function onboardingIncludedCreditsIdempotencyKey(userId: string): string {
  return `onboarding_included_credits_grant:${userId}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

export type ActivateIncludedCreditsResult = {
  ok: true;
  alreadyClaimed: boolean;
  creditsGranted: number;
  /** Montant configuré BO au moment de l’activation. */
  includedCreditsAmount: number;
};

async function walletTransactionExists(admin: SupabaseAdmin, idempotencyKey: string): Promise<boolean> {
  const { data, error } = await admin
    .from("wallet_transactions")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

/** Anciens flux (grant mensuel guest ou repli onboarding) — empêche un second crédit. */
async function hasLegacyOnboardingIncludedCreditsGrant(
  admin: SupabaseAdmin,
  userId: string,
): Promise<boolean> {
  const { data: viaMeta, error: metaError } = await admin
    .from("wallet_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>activated_via", "onboarding_offer")
    .limit(1);
  if (metaError) throw new Error(metaError.message);
  if (viaMeta?.length) return true;

  const { data: viaPrefix, error: prefixError } = await admin
    .from("wallet_transactions")
    .select("id")
    .eq("user_id", userId)
    .like("idempotency_key", `subscription_monthly_consumption_grant:${userId}:%:guest`)
    .limit(1);
  if (prefixError) throw new Error(prefixError.message);
  return Boolean(viaPrefix?.length);
}

const ONBOARDING_OFFER_CLAIM_FROM_STEPS = ["offer", "panier"] as const;

/** Crédits inclus onboarding déjà crédités (one-shot ou anciens flux). */
export async function hasOnboardingIncludedCreditsGrant(admin: SupabaseAdmin, userId: string): Promise<boolean> {
  if (await walletTransactionExists(admin, onboardingIncludedCreditsIdempotencyKey(userId))) {
    return true;
  }
  return hasLegacyOnboardingIncludedCreditsGrant(admin, userId);
}

async function creditOnboardingIncludedCredits(
  admin: SupabaseAdmin,
  userId: string,
  amount: number,
): Promise<boolean> {
  const grant = Math.max(0, Math.floor(amount));
  if (grant <= 0) return false;

  const idempotencyKey = onboardingIncludedCreditsIdempotencyKey(userId);
  if (await walletTransactionExists(admin, idempotencyKey)) return false;

  const { error: txInsertError } = await admin.from("wallet_transactions").insert({
    user_id: userId,
    kind: "credit",
    direction: "credit",
    amount_points: grant,
    status: "posted",
    idempotency_key: idempotencyKey,
    credit_bucket: "consumption",
    metadata: {
      source: "onboarding_included_credits",
      plan_code: "guest",
      activated_via: "onboarding_offer",
    },
  });

  if (txInsertError) {
    const code = String(txInsertError.code ?? "");
    const duplicate =
      code === "23505" || txInsertError.message?.toLowerCase().includes("duplicate") === true;
    if (duplicate) return false;
    throw new Error(txInsertError.message);
  }

  const { data: walletRow, error: walletReadError } = await admin
    .from("user_wallets")
    .select("id,balance_consumption_points,balance_points")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (walletReadError) throw new Error(walletReadError.message);

  if (walletRow?.id) {
    const current = Math.max(0, Math.floor(Number(walletRow.balance_consumption_points ?? 0)));
    const { error: walletUpdateError } = await admin
      .from("user_wallets")
      .update({
        balance_consumption_points: current + grant,
        updated_at: new Date().toISOString(),
      })
      .eq("id", walletRow.id);
    if (walletUpdateError) throw new Error(walletUpdateError.message);
  } else {
    const { error: walletInsertError } = await admin.from("user_wallets").insert({
      user_id: userId,
      balance_consumption_points: grant,
      balance_exchange_points: 0,
    });
    if (walletInsertError) throw new Error(walletInsertError.message);
  }

  return true;
}

/**
 * Répare un compte bloqué sur `offer` / `panier` alors que les crédits inclus sont déjà crédités.
 * Retourne `true` si l’étape a été avancée vers `exchange`.
 */
export async function repairOnboardingProcessAfterIncludedCreditsClaim(
  admin: SupabaseAdmin,
  userId: string,
): Promise<boolean> {
  if (!(await hasOnboardingIncludedCreditsGrant(admin, userId))) {
    return false;
  }

  const { data, error } = await admin
    .from("users")
    .update({ onboarding_process: "exchange" })
    .eq("id", userId)
    .in("onboarding_process", [...ONBOARDING_OFFER_CLAIM_FROM_STEPS])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.id);
}

/**
 * Active les crédits inclus Guest à l’étape onboarding « offer » (une fois par compte).
 * Avance `onboarding_process` → `exchange` puis crédite le wallet depuis le BO.
 */
export async function activateOnboardingIncludedCredits(
  admin: SupabaseAdmin,
  userId: string,
): Promise<ActivateIncludedCreditsResult> {
  const limits = await fetchPlanEntitlementComparisonLimits();
  const includedCreditsAmount = Math.max(0, Math.floor(limits.guestMonthlyCredits));

  const alreadyHasGrant = await hasOnboardingIncludedCreditsGrant(admin, userId);

  const { data: updatedUser, error: userUpdateError } = await admin
    .from("users")
    .update({ onboarding_process: "exchange" })
    .eq("id", userId)
    .in("onboarding_process", [...ONBOARDING_OFFER_CLAIM_FROM_STEPS])
    .select("id")
    .maybeSingle();

  if (userUpdateError) {
    throw new Error(userUpdateError.message);
  }

  if (!updatedUser?.id) {
    await repairOnboardingProcessAfterIncludedCreditsClaim(admin, userId);
    return {
      ok: true,
      alreadyClaimed: true,
      creditsGranted: 0,
      includedCreditsAmount,
    };
  }

  if (alreadyHasGrant) {
    return {
      ok: true,
      alreadyClaimed: true,
      creditsGranted: 0,
      includedCreditsAmount,
    };
  }

  const credited =
    includedCreditsAmount > 0
      ? await creditOnboardingIncludedCredits(admin, userId, includedCreditsAmount)
      : false;

  return {
    ok: true,
    alreadyClaimed: false,
    creditsGranted: credited ? includedCreditsAmount : 0,
    includedCreditsAmount,
  };
}

/** Étape onboarding effective pour le filtrage CMS (répare les comptes bloqués). */
export async function resolveOnboardingProcessForOfferVisibility(
  admin: SupabaseAdmin,
  userId: string,
  onboardingProcess: string | null | undefined,
  includedCreditsClaimed: boolean,
): Promise<string | null | undefined> {
  if (!includedCreditsClaimed) {
    return onboardingProcess;
  }
  const repaired = await repairOnboardingProcessAfterIncludedCreditsClaim(admin, userId);
  return repaired ? "exchange" : onboardingProcess;
}
