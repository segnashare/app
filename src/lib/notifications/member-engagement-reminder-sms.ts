/** SMS rappels engagement membre (cron, gate `SEGNA_NOTIFY_SMS_ALERTS=1`). */

import {
  appendSmsAppLink,
  memberAppHomeUrl,
  memberAppShopUrl,
} from "@/lib/notifications/member-app-links";

/** 1er rappel — compte entre J+3 et J+9, onboarding in-app ≠ `finished`. */
export function buildOnboardingIncompleteReminderSms(): string {
  return appendSmsAppLink(
    "Ton onboarding n’est pas terminé. Finalise-le pour emprunter ton premier panier gratuitement !",
    memberAppHomeUrl(),
  );
}

/** 2e rappel — compte ≥ J+10, même critère onboarding. */
export function buildOnboardingIncompleteFollowupReminderSms(): string {
  return appendSmsAppLink(
    "Il te reste quelques étapes pour finir ton onboarding et emprunter ton 1er panier. On t’attend sur l’app !",
    memberAppHomeUrl(),
  );
}

export function buildAbandonedCartReminderSms(): string {
  return appendSmsAppLink(
    "Ton panier t'attend. Finalise-le et profite de l'échange gratuit.",
    memberAppShopUrl(),
  );
}

/** Exemples statiques (validation produit / copy). */
export const MEMBER_ENGAGEMENT_REMINDER_SMS_COPY = {
  onboardingIncompleteFirst: buildOnboardingIncompleteReminderSms(),
  onboardingIncompleteSecond: buildOnboardingIncompleteFollowupReminderSms(),
  abandonedCart: buildAbandonedCartReminderSms(),
} as const;
