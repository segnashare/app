/** Raisons du questionnaire « Renoncer à l’abonnement » (stables pour le BO). */
export const SUBSCRIPTION_CANCEL_REASONS = [
  {
    code: "pause",
    label: "J’ai envie de faire une pause",
    icon: "clock" as const,
  },
  {
    code: "benefits",
    label: "Les avantages Segna ne me correspondent pas",
    icon: "gift" as const,
  },
  {
    code: "price",
    label: "L’abonnement est trop cher",
    icon: "receipt" as const,
  },
  {
    code: "issues",
    label: "Je rencontre des problèmes avec le service",
    icon: "alert" as const,
  },
  {
    code: "not_enough_use",
    label: "Je n’utilise pas assez Segna",
    icon: "coins" as const,
  },
] as const;

export type SubscriptionCancelReasonCode = (typeof SUBSCRIPTION_CANCEL_REASONS)[number]["code"];

export function isSubscriptionCancelReasonCode(value: string): value is SubscriptionCancelReasonCode {
  return SUBSCRIPTION_CANCEL_REASONS.some((r) => r.code === value);
}

export function labelForCancelReason(code: string): string {
  return SUBSCRIPTION_CANCEL_REASONS.find((r) => r.code === code)?.label ?? code;
}
