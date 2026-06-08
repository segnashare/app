/**
 * Identifiants stables pour `notification_send_log.kind` et le suivi produit.
 *
 * **Paiements / abo** : `cart_order_paid` (e-mail + SMS prépa si Twilio + tél.), `cart_order_n8n_declared` (workflow n8n commande confirmée), `cart_order_canceled_backoffice_prep` (annulation BO avant expédition), `cart_order_canceled_member` (annulation membre depuis l’app avant expédition), `wallet_credits_stripe`, `subscription_segna_x_welcome`
 *
 * **Commande / expédition (branché sur `transition_shipment_status`)**  
 * - `order_outbound_ready_to_ship` : aller **pending → ready** — e-mail + SMS (réf. commande, n° suivi, lien suivi)  
 * - `order_outbound_transit_partner` : aller `dropped_in` — **SMS seulement** (commande + pièces en transit, lien suivi) ; pas si Uber domicile  
 * - `order_outbound_relay_pickup_ready` : aller `dropped_out` — e-mail + SMS « colis disponible au relais » ; pas si Uber domicile  
 * - `order_outbound_delivered` : aller livré (`in_transit_in` → `delivered`, etc.) — e-mail récap (location, échéance retour) + SMS  
 * - `return_member_dropped_parcel` : retour déposé au relais — e-mail + SMS si l’aller n’était pas Uber domicile  
 * - `return_exchange_complete` : retour `dropped_in` — **SMS seulement** (échange terminé côté membre ; contrôle Segna à suivre)  
 * - `return_received_by_segna` : retour réceptionné / en vérification côté Segna
 * - `member_intake_dropped_in` : envoi membre → Segna `in_transit_out` — **SMS seul** (pièce en route, crédits d’échange après vérif)
 *
 * **Emprunt / délais** : `borrow_return_deadline_reminder` — J-7/J-3/J-1 (19h30 Paris) + J-J (10h Paris) ; e-mail + SMS  
 * - `borrow_overdue_daily` — 10h Paris (même cron matin) ; pénalité journalière après échéance
 *
 * **Pièce / annonce** (via `POST /api/internal/member-lifecycle/notify`)  
 * - `item_listing_evaluated`, `item_received_by_segna`, `item_validated_by_segna`
 * - `item_intake_verified` : clic BO « Vérifiée physiquement » (file Vérification) — **SMS seul** (dressing + crédits d’échange)
 *
 * **Onboarding in-app** : `onboarding_reward_complete` — SMS après passage de l’étape « reward » à « finished » (`POST /api/onboarding/finish-reward`).
 *
 * **Parrainage** : `referral_referrer_bonus` — SMS au parrain lorsque le filleul est qualifié (`POST /api/referral/dispatch-referrer-notify`, cron).
 *
 * **Engagement** (crons séparés, `SEGNA_NOTIFY_SMS_ALERTS=1`, max 2 SMS/jour Paris — emprunt prioritaire)  
 * - `onboarding_incomplete_reminder` — 15h Paris (`member-onboarding-reminders`)  
 * - `onboarding_incomplete_reminder_followup` — idem  
 * - `abandoned_cart_reminder` — 18h Paris (`member-abandoned-cart-reminders`)
 */
export const NotificationKind = {
  cartOrderPaid: "cart_order_paid",
  cartOrderN8nDeclared: "cart_order_n8n_declared",
  /** Annulation BO avant expédition (aller encore « en préparation ») : e-mail + SMS transactionnel. */
  cartOrderCanceledBackofficePrep: "cart_order_canceled_backoffice_prep",
  /** Annulation membre (app) avant prise en charge transporteur : e-mail + SMS transactionnel. */
  cartOrderCanceledMember: "cart_order_canceled_member",
  walletCreditsStripe: "wallet_credits_stripe",
  subscriptionSegnaXWelcome: "subscription_segna_x_welcome",
  orderOutboundReadyToShip: "order_outbound_ready_to_ship",
  orderOutboundTransitPartner: "order_outbound_transit_partner",
  orderOutboundRelayPickupReady: "order_outbound_relay_pickup_ready",
  orderOutboundDelivered: "order_outbound_delivered",
  returnMemberDroppedParcel: "return_member_dropped_parcel",
  returnExchangeComplete: "return_exchange_complete",
  returnReceivedBySegna: "return_received_by_segna",
  memberIntakeDroppedIn: "member_intake_dropped_in",
  borrowReturnDeadlineReminder: "borrow_return_deadline_reminder",
  borrowOverdueDaily: "borrow_overdue_daily",
  itemListingEvaluated: "item_listing_evaluated",
  itemReceivedBySegna: "item_received_by_segna",
  itemValidatedBySegna: "item_validated_by_segna",
  itemIntakeVerified: "item_intake_verified",
  onboardingRewardComplete: "onboarding_reward_complete",
  referralReferrerBonus: "referral_referrer_bonus",
  onboardingIncompleteReminder: "onboarding_incomplete_reminder",
  onboardingIncompleteReminderFollowup: "onboarding_incomplete_reminder_followup",
  abandonedCartReminder: "abandoned_cart_reminder",
  /** Valeur d'échange catalogue ajustée par le moteur demande. */
  itemExchangePriceChanged: "item_exchange_price_changed",
  /** Prix panier actif actualisé après recalibrage. */
  cartExchangePriceChanged: "cart_exchange_price_changed",
} as const;

export type NotificationKindId = (typeof NotificationKind)[keyof typeof NotificationKind];
