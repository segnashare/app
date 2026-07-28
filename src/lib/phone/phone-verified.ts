import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";

export type PhoneVerifiedLookup = {
  /** `public.users.phone` — verrouillé après OTP. */
  usersPhone?: string | null;
  /** `user_profiles.profile_data.phone_e164` — peut être en attente. */
  profilePhoneE164?: string | null;
  /** `user_profiles.profile_data.phone_code_verified`. */
  phoneCodeVerified?: boolean | null;
  /** `auth.users.phone`. */
  authPhone?: string | null;
  /** `auth.users.phone_confirmed_at`. */
  phoneConfirmedAt?: string | null;
};

/**
 * Téléphone réellement validé (OTP / Auth).
 * Un `phone_e164` en attente (onboarding website sans confirmation) ne compte pas.
 */
export function resolveVerifiedPhoneE164(input: PhoneVerifiedLookup): string | null {
  const usersPhone = tryNormalizePhoneToE164(input.usersPhone ?? null);
  if (usersPhone) return usersPhone;

  if (input.phoneCodeVerified === true) {
    const profilePhone = tryNormalizePhoneToE164(input.profilePhoneE164 ?? null);
    if (profilePhone) return profilePhone;
  }

  if (input.phoneConfirmedAt) {
    const authPhone = tryNormalizePhoneToE164(input.authPhone ?? null);
    if (authPhone) return authPhone;
  }

  return null;
}

export function isPhoneVerified(input: PhoneVerifiedLookup): boolean {
  return resolveVerifiedPhoneE164(input) != null;
}
