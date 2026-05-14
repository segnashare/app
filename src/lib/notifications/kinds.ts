/**
 * Identifiants stables pour `notification_send_log.kind` et le suivi produit.
 *
 * **Paiements / abo** : `cart_order_paid` (e-mail + SMS prépa si Twilio + tél.), `cart_order_canceled_backoffice_prep` (annulation BO avant expédition), `wallet_credits_stripe`, `subscription_segna_x_welcome`
 *
 * **Commande / expédition (branché sur `transition_shipment_status`)**  
 * - `order_outbound_ready_to_ship` : aller **pending → ready** — e-mail ; SMS seulement sur cette transition  
 * - `order_outbound_transit_partner` : aller `dropped_in` — **SMS seulement** (en transit chez le partenaire, pas retrait) ; pas si Uber domicile  
 * - `order_outbound_relay_pickup_ready` : aller `dropped_out` — e-mail + SMS « colis disponible au relais » ; pas si Uber domicile  
 * - `order_outbound_delivered` : aller livré — demande de vérification côté membre  
 * - `return_member_dropped_parcel` : retour déposé au relais — e-mail + SMS si l’aller n’était pas Uber domicile  
 * - `return_received_by_segna` : retour réceptionné / en vérification côté Segna
 *
 * **Emprunt / délais** : `borrow_return_deadline_reminder` — cron ; e-mail + SMS si `SEGNA_NOTIFY_SMS_ALERTS=1`
 *
 * **Pièce / annonce** (via `POST /api/internal/member-lifecycle/notify`)  
 * - `item_listing_evaluated`, `item_received_by_segna`, `item_validated_by_segna`
 *
 * **Onboarding in-app** : `onboarding_reward_complete` — SMS après passage de l’étape « reward » à « finished » (`POST /api/onboarding/finish-reward`).
 *
 * **Parrainage** : `referral_referrer_bonus` — SMS au parrain lorsque le filleul est qualifié (`POST /api/referral/dispatch-referrer-notify`, cron).
 */
export const NotificationKind = {
  cartOrderPaid: "cart_order_paid",
  /** Annulation BO avant expédition (aller encore « en préparation ») : e-mail + SMS transactionnel. */
  cartOrderCanceledBackofficePrep: "cart_order_canceled_backoffice_prep",
  walletCreditsStripe: "wallet_credits_stripe",
  subscriptionSegnaXWelcome: "subscription_segna_x_welcome",
  orderOutboundReadyToShip: "order_outbound_ready_to_ship",
  orderOutboundTransitPartner: "order_outbound_transit_partner",
  orderOutboundRelayPickupReady: "order_outbound_relay_pickup_ready",
  orderOutboundDelivered: "order_outbound_delivered",
  returnMemberDroppedParcel: "return_member_dropped_parcel",
  returnReceivedBySegna: "return_received_by_segna",
  borrowReturnDeadlineReminder: "borrow_return_deadline_reminder",
  itemListingEvaluated: "item_listing_evaluated",
  itemReceivedBySegna: "item_received_by_segna",
  itemValidatedBySegna: "item_validated_by_segna",
  onboardingRewardComplete: "onboarding_reward_complete",
  referralReferrerBonus: "referral_referrer_bonus",
} as const;

export type NotificationKindId = (typeof NotificationKind)[keyof typeof NotificationKind];
