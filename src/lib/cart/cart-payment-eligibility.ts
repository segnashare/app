import { KYC_REQUIRED_FOR_BORROW } from "@/lib/kyc/kyc-policy";
import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";
import {
  cartPaymentProfileGateMessage,
  fetchOnboardingProfileRequirements,
  isOnboardingProfileReady,
} from "@/lib/profile/onboarding-profile-requirements";

export type CartPaymentEligibility = {
  profileComplete: boolean;
  kycVerified: boolean;
  canAccessPayment: boolean;
};

/**
 * Profil « prêt » comme à l’onboarding (1 photo + infos essentielles) ;
 * KYC validé requis seulement si `KYC_REQUIRED_FOR_BORROW`.
 */
export async function fetchCartPaymentEligibility(
  supabase: Parameters<typeof fetchOnboardingProfileRequirements>[0],
  admin: { from: (t: string) => unknown },
  userId: string,
): Promise<CartPaymentEligibility> {
  const [kycVerified, requirements] = await Promise.all([
    fetchUserKycVerified(admin as Parameters<typeof fetchUserKycVerified>[0], userId),
    fetchOnboardingProfileRequirements(supabase, userId),
  ]);

  const profileComplete = requirements != null && isOnboardingProfileReady(requirements);

  return {
    profileComplete,
    kycVerified,
    canAccessPayment: profileComplete && (!KYC_REQUIRED_FOR_BORROW || kycVerified),
  };
}

export { cartPaymentProfileGateMessage };
