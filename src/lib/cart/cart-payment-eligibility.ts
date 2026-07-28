import { KYC_REQUIRED_FOR_BORROW } from "@/lib/kyc/kyc-policy";
import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";
import { isPhoneVerified } from "@/lib/phone/phone-verified";
import {
  cartPaymentProfileGateMessage,
  fetchOnboardingProfileRequirements,
  isOnboardingProfileReady,
} from "@/lib/profile/onboarding-profile-requirements";

export type CartPaymentEligibility = {
  profileComplete: boolean;
  kycVerified: boolean;
  /** Numéro mobile FR validé par OTP (pas seulement saisi en attente). */
  phoneReady: boolean;
  canAccessPayment: boolean;
};

type PhoneLookupClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
};

async function fetchUserPhoneReady(supabase: PhoneLookupClient, userId: string): Promise<boolean> {
  const [{ data: userRow }, { data: profileRow }] = await Promise.all([
    supabase.from("users").select("phone").eq("id", userId).maybeSingle(),
    supabase.from("user_profiles").select("profile_data").eq("user_id", userId).maybeSingle(),
  ]);

  const usersPhone =
    userRow && typeof userRow === "object" && typeof (userRow as { phone?: unknown }).phone === "string"
      ? (userRow as { phone: string }).phone
      : null;
  const profileData =
    profileRow && typeof profileRow === "object"
      ? ((profileRow as { profile_data?: unknown }).profile_data as Record<string, unknown> | null)
      : null;
  const profilePhone =
    profileData && typeof profileData.phone_e164 === "string" ? profileData.phone_e164 : null;
  const phoneCodeVerified = profileData?.phone_code_verified === true;

  return isPhoneVerified({
    usersPhone,
    profilePhoneE164: profilePhone,
    phoneCodeVerified,
  });
}

/**
 * Profil « prêt » comme à l’onboarding (infos essentielles) + numéro de téléphone ;
 * KYC validé requis seulement si `KYC_REQUIRED_FOR_BORROW`.
 */
export async function fetchCartPaymentEligibility(
  supabase: Parameters<typeof fetchOnboardingProfileRequirements>[0],
  admin: { from: (t: string) => unknown },
  userId: string,
): Promise<CartPaymentEligibility> {
  const [kycVerified, requirements, phoneReady] = await Promise.all([
    fetchUserKycVerified(admin as Parameters<typeof fetchUserKycVerified>[0], userId),
    fetchOnboardingProfileRequirements(supabase, userId),
    fetchUserPhoneReady(supabase as PhoneLookupClient, userId),
  ]);

  const profileComplete = requirements != null && isOnboardingProfileReady(requirements);

  return {
    profileComplete,
    kycVerified,
    phoneReady,
    canAccessPayment:
      profileComplete && phoneReady && (!KYC_REQUIRED_FOR_BORROW || kycVerified),
  };
}

export function cartPaymentPhoneGateMessage(): string {
  return "Confirme ton numéro de téléphone mobile par SMS pour réserver et payer ta commande.";
}

export { cartPaymentProfileGateMessage };
