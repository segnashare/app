import type { AnalyticsEventName } from "@/lib/analytics/events";

export type SmsNotificationImpact = {
  /** Event Segna attendu dans la fenêtre (step 2 du funnel PostHog). */
  goalEvent: AnalyticsEventName;
  goalFilter?: { property: string; value: string | boolean | number };
  windowHours: number;
  description: string;
};

/**
 * Objectif produit attendu par type de SMS (fenêtre 48h par défaut).
 * PostHog : funnel `notification_sent` (filtre `kind`) → `goalEvent` (+ filtre step 2 si défini).
 */
export const SMS_NOTIFICATION_IMPACT_BY_KIND: Record<string, SmsNotificationImpact> = {
  abandoned_cart_reminder: {
    goalEvent: "cart_checkout_started",
    windowHours: 48,
    description: "Panier abandonné → réservation / checkout",
  },
  onboarding_incomplete_reminder: {
    goalEvent: "onboarding_in_app_step_completed",
    goalFilter: { property: "to_step", value: "finished" },
    windowHours: 48,
    description: "Onboarding in-app incomplet → checklist terminée",
  },
  onboarding_incomplete_reminder_followup: {
    goalEvent: "onboarding_in_app_step_completed",
    goalFilter: { property: "to_step", value: "finished" },
    windowHours: 48,
    description: "Relance onboarding → checklist terminée",
  },
  onboarding_reward_complete: {
    goalEvent: "cart_item_added",
    windowHours: 48,
    description: "Fin reward onboarding → 1er article au panier",
  },
  referral_referrer_bonus: {
    goalEvent: "cart_item_added",
    windowHours: 48,
    description: "Bonus parrain → activité emprunt (ajout panier)",
  },
  item_intake_verified: {
    goalEvent: "shop_viewed",
    windowHours: 48,
    description: "Pièce dispo (SMS prêteuse) → retour shop (engagement)",
  },
  member_intake_dropped_in: {
    goalEvent: "item_submitted",
    windowHours: 48,
    description: "Envoi pièce vers Segna → soumission complète (pipeline prêteuse)",
  },
  cart_order_paid: {
    goalEvent: "order_received",
    windowHours: 48,
    description: "Commande payée (SMS) → réception confirmée",
  },
  order_outbound_ready_to_ship: {
    goalEvent: "order_received",
    windowHours: 48,
    description: "Expédition préparée → réception",
  },
  order_outbound_transit_partner: {
    goalEvent: "order_received",
    windowHours: 48,
    description: "Colis en transit → réception",
  },
  order_outbound_relay_pickup_ready: {
    goalEvent: "order_received",
    windowHours: 48,
    description: "Colis au relais → réception",
  },
  order_outbound_delivered: {
    goalEvent: "order_received",
    windowHours: 48,
    description: "Livré → réception confirmée in-app",
  },
  borrow_return_deadline_reminder: {
    goalEvent: "order_returned",
    goalFilter: { property: "phase", value: "return_initiated" },
    windowHours: 48,
    description: "Rappel échéance retour → retour initié",
  },
  borrow_overdue_daily: {
    goalEvent: "order_returned",
    goalFilter: { property: "phase", value: "return_initiated" },
    windowHours: 48,
    description: "Retard retour → retour initié",
  },
  return_member_dropped_parcel: {
    goalEvent: "order_returned",
    goalFilter: { property: "phase", value: "return_feedback_submitted" },
    windowHours: 48,
    description: "Retour déposé → feedback retour",
  },
  return_exchange_complete: {
    goalEvent: "order_returned",
    goalFilter: { property: "phase", value: "return_received_segna" },
    windowHours: 48,
    description: "Échange terminé → retour réceptionné Segna",
  },
  subscription_segna_x_welcome: {
    goalEvent: "cart_checkout_started",
    windowHours: 48,
    description: "Bienvenue Segna X → 1er checkout emprunt",
  },
};

const DEFAULT_IMPACT: SmsNotificationImpact = {
  goalEvent: "shop_viewed",
  windowHours: 48,
  description: "Engagement générique → visite shop",
};

export function lookupSmsNotificationImpact(kind: string): SmsNotificationImpact {
  return SMS_NOTIFICATION_IMPACT_BY_KIND[kind] ?? DEFAULT_IMPACT;
}

/** Funnels PostHog SMS → objectif (conversion window = `windowHours` en heures). */
export const POSTHOG_SMS_IMPACT_FUNNELS = Object.entries(SMS_NOTIFICATION_IMPACT_BY_KIND).map(
  ([kind, impact]) => ({
    id: `sms_impact_${kind}`,
    name: `SMS → ${impact.description}`,
    kind,
    windowHours: impact.windowHours,
    steps: [
      { event: "notification_sent", filter: { property: "kind", value: kind } },
      impact.goalFilter
        ? {
            event: impact.goalEvent,
            filter: impact.goalFilter,
          }
        : impact.goalEvent,
    ],
  }),
);
