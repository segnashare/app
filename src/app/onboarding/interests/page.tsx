import { redirect } from "next/navigation";

/** Ancienne étape supprimée du parcours : les liens / sessions restantes renvoient vers la suite. */
export default function OnboardingInterestsRedirectPage() {
  redirect("/onboarding/privacy");
}
