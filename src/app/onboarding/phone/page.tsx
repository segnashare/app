import { redirect } from "next/navigation";

/** Téléphone retiré du funnel onboarding app. OTP reste au paiement / abo. */
export default function OnboardingPhoneLegacyRedirectPage() {
  redirect("/onboarding/name");
}
