import { redirect } from "next/navigation";

/** Ancienne étape : le parcours passe par `/onboarding/3` puis `/home`. */
export default function OnboardingPrivacyLegacyRedirectPage() {
  redirect("/onboarding/3");
}
