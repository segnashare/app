import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";

export type CartPaymentEligibility = {
  profileComplete: boolean;
  kycVerified: boolean;
  canAccessPayment: boolean;
};

function parseProfileCompletionScore(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const raw =
    row.score ??
    row.completion_score ??
    profileData.completion_score ??
    profileData.profile_completion ??
    profileData.score ??
    profileData.progress_score;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Profil à 100 % + KYC validé requis pour accéder au paiement panier (UI + API).
 */
export async function fetchCartPaymentEligibility(
  supabase: { from: (t: string) => { select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } },
  admin: { from: (t: string) => unknown },
  userId: string,
): Promise<CartPaymentEligibility> {
  const [kycVerified, profileRes] = await Promise.all([
    fetchUserKycVerified(admin as Parameters<typeof fetchUserKycVerified>[0], userId),
    supabase.from("user_profiles").select("score, completion_score, profile_data").eq("user_id", userId).maybeSingle(),
  ]);

  const profileRow = (profileRes.data ?? null) as Record<string, unknown> | null;
  const score = parseProfileCompletionScore(profileRow);
  const profileComplete = score >= 100;

  return {
    profileComplete,
    kycVerified,
    canAccessPayment: profileComplete && kycVerified,
  };
}
