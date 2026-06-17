/**
 * 10 funnels Segna à recréer dans PostHog (Product analytics → + New → New funnel).
 * Chaque `steps[]` = un step du funnel dans l’ordre.
 *
 * Filtres PostHog : ajouter une propriété sur un step quand `filter` est défini.
 */
export const POSTHOG_FUNNEL_INSIGHTS = [
  {
    id: "activation_emprunteuse",
    name: "Activation emprunteuse",
    description: "Signup → onboarding → shop → panier → checkout → commande payée",
    steps: [
      "user_signed_up",
      "onboarding_completed",
      "shop_viewed",
      "cart_item_added",
      "cart_checkout_started",
      "order_confirmed",
    ],
  },
  {
    id: "activation_preteuse",
    name: "Activation prêteuse",
    description: "Signup → brouillon pièce → soumission → prix confirmé → disponible au catalogue",
    steps: [
      "user_signed_up",
      "onboarding_completed",
      "item_draft_started",
      "item_submitted",
      "item_price_confirmed",
      "item_available",
    ],
  },
  {
    id: "onboarding_signup",
    name: "Onboarding signup (email)",
    description: "Email OTP → téléphone vérifié → fin onboarding signup",
    steps: ["auth_sign_up_started", "phone_verified", "onboarding_completed"],
  },
  {
    id: "onboarding_in_app",
    name: "Onboarding in-app (checklist)",
    description: "Même event, filtre `to_step` différent à chaque step PostHog",
    steps: [
      { event: "onboarding_in_app_step_completed", filter: { property: "to_step", value: "profile" } },
      { event: "onboarding_in_app_step_completed", filter: { property: "to_step", value: "panier" } },
      { event: "onboarding_in_app_step_completed", filter: { property: "to_step", value: "exchange" } },
      { event: "onboarding_in_app_step_completed", filter: { property: "to_step", value: "finished" } },
    ],
  },
  {
    id: "abandon_checkout",
    name: "Abandon checkout",
    description: "Réservation panier sans commande confirmée (fenêtre 24h)",
    steps: ["cart_checkout_started", "order_confirmed"],
  },
  {
    id: "credits_offerts_premier_emprunt",
    name: "Crédits offerts → 1er emprunt",
    steps: ["included_credits_activated", "cart_item_added", "order_confirmed"],
  },
  {
    id: "parrainage_activation",
    name: "Parrainage → activation",
    description: "Step 1 : filtre `referral_code_present` = true sur `user_signed_up`",
    steps: [
      { event: "user_signed_up", filter: { property: "referral_code_present", value: true } },
      "referral_qualified",
      "order_confirmed",
    ],
  },
  {
    id: "boucle_post_achat",
    name: "Boucle post-achat",
    steps: ["order_confirmed", "order_received", "order_returned"],
  },
  {
    id: "shop_vers_emprunt",
    name: "Shop → emprunt",
    steps: ["shop_viewed", "cart_item_added", "cart_checkout_started", "order_confirmed"],
  },
  {
    id: "abonnement_segna_x",
    name: "Abonnement Segna X",
    steps: ["subscription_checkout_started", "subscription_confirmed"],
  },
] as const;
