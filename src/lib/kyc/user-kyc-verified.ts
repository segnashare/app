/** Statuts Stripe Identity / internes considérés comme KYC validé (aligné sur ProfileTabs). */
export function isVerificationStatusKycVerified(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s === "verified" || s === "approved" || s === "validated";
}

/**
 * Indique si l’utilisateur a une ligne KYC au statut « validé ».
 * À utiliser avec le client admin (service role) ou un client dont les RLS autorisent la lecture.
 */
export async function fetchUserKycVerified(supabase: { from: (t: string) => any }, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_identity_verifications")
    .select("verification_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return isVerificationStatusKycVerified((data as { verification_status?: unknown }).verification_status);
}
