/** Copy relances engagement (cron). Push only — plus de SMS marketing. */

/** 1er rappel — compte entre J+3 et J+9, onboarding in-app ≠ `finished`. */
export function buildOnboardingIncompleteReminderPush(): string {
  return "Ton onboarding n’est pas terminé. Finalise-le pour emprunter ton premier panier gratuitement !";
}

/** 2e rappel — compte ≥ J+10, même critère onboarding. */
export function buildOnboardingIncompleteFollowupReminderPush(): string {
  return "Il te reste quelques étapes pour finir ton onboarding et emprunter ton 1er panier. On t’attend sur l’app !";
}

export function buildAbandonedCartReminderPush(): string {
  return "Ton panier t'attend. Finalise-le et profite de l'échange gratuit.";
}

/** @deprecated Conservé pour les tests / copies existantes — plus envoyé en SMS. */
export const buildOnboardingIncompleteReminderSms = buildOnboardingIncompleteReminderPush;
/** @deprecated Conservé pour les tests / copies existantes — plus envoyé en SMS. */
export const buildOnboardingIncompleteFollowupReminderSms =
  buildOnboardingIncompleteFollowupReminderPush;
/** @deprecated Conservé pour les tests / copies existantes — plus envoyé en SMS. */
export const buildAbandonedCartReminderSms = buildAbandonedCartReminderPush;

/** Exemples statiques (validation produit / copy). */
export const MEMBER_ENGAGEMENT_REMINDER_SMS_COPY = {
  onboardingIncompleteFirst: buildOnboardingIncompleteReminderPush(),
  onboardingIncompleteSecond: buildOnboardingIncompleteFollowupReminderPush(),
  abandonedCart: buildAbandonedCartReminderPush(),
} as const;
