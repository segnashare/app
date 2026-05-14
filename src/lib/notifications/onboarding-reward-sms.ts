/**
 * SMS court après la modale « reward » (onboarding in-app terminé).
 * Reste sous la limite utile Twilio / segments (troncature côté envoi à 320 car.).
 */
export function buildOnboardingRewardCompletionSms(firstName: string | null | undefined): string {
  const name = typeof firstName === "string" ? firstName.trim() : "";
  const bravo = name ? `Bravo ${name}` : "Bravo";
  return `${bravo}, ton onboarding Segna est terminé. Profite de l’échange pour emprunter des dizaines de pièces premium chaque mois. À très vite sur l’app !`;
}
