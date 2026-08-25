/**
 * Identifiants stables pour `notification_send_log.kind` et le suivi produit.
 *
 * **Paiements / abo** : `cart_order_paid` (e-mail + push « cooking » ; achat/Guest : SMS confirmation seul, clé `txn:purchase_order_paid_sms:{cartId}`, l’e-mail = facture Stripe), `cart_order_n8n_declared` (workflow n8n commande confirmée), `user_registered_n8n_declared` (Discord / n8n nouveau compte), `cart_order_canceled_backoffice_prep` (annulation BO avant expédition), `cart_order_canceled_member` (annulation membre depuis l’app avant expédition), `wallet_credits_stripe`, `subscription_segna_x_welcome`, `subscription_cancel_scheduled` (annulation fin de période)
 *
 * **Commande / expédition (branché sur `transition_shipment_status`)**  
 * - `order_outbound_ready_to_ship` : aller **pending → ready** — e-mail (détail suivi) + SMS/push phrase courte  
 * - `order_outbound_transit_partner` : aller `dropped_in` — **SMS/push seulement** (phrase courte) ; pas si Uber domicile  
 * - `order_outbound_relay_pickup_ready` : aller `dropped_out` — e-mail + SMS « colis disponible au relais » ; pas si Uber domicile  
 * - `order_outbound_delivered` : aller livré — push/SMS « Clique sur Tout est OK… » (deep link commande)  
 * - `return_member_dropped_parcel` : retour déposé au relais — e-mail + SMS si l’aller n’était pas Uber domicile  
 * - `return_exchange_complete` : retour `dropped_in` — **SMS seulement** (échange terminé côté membre ; contrôle Segna à suivre)  
 * - `return_received_by_segna` : retour réceptionné / en vérification côté Segna
 * - `return_confirmed` : reprise BO sans litige — e-mail + push « Tout est bon ! » (+ SMS), deep link retour + modale avis
 * - `member_intake_dropped_in` : envoi membre → Segna `in_transit_out` — **SMS seul** (pièce en route, crédits d’échange après vérif)
 *
 * **Emprunt / délais** : `borrow_return_deadline_reminder` — J-7/J-3/J-1 (19h30 Paris) e-mail + push ; J-J (10h Paris) e-mail + push + SMS  
 * - `borrow_overdue_daily` — 10h Paris ; pénalité journalière après échéance — e-mail + push (pas de SMS)  
 * - `borrow_formal_notice_sent` — J+21 MED AR24 ; e-mail + push + SMS  
 * - `borrow_non_restitution_invoiced` — post-deadline MED ; facture Stripe panier + frais traitement
 * - `guest_purchase_invoiced` — achat Guest ; confirmation + facture PDF (un seul e-mail)
 *
 * **Pièce / annonce** (via `POST /api/internal/member-lifecycle/notify`)  
 * - `item_listing_evaluated`, `item_received_by_segna`, `item_validated_by_segna`
 * - `item_intake_verified` : clic BO « Vérifiée physiquement » (file Vérification) — **SMS seul** (dressing + crédits d’échange)
 *
 * **Onboarding in-app** : `onboarding_reward_complete` — SMS après passage de l’étape « reward » à « finished » (`POST /api/onboarding/finish-reward`).
 *
 * **Parrainage** : `referral_referrer_bonus` — SMS au parrain lorsque le filleul est qualifié (`POST /api/referral/dispatch-referrer-notify`, cron).
 *
 * **Litige BO** (via `POST /api/internal/dispute-ops-notify`)  
 * - `dispute_return_recovered`, `dispute_member_auth_suspended`, `dispute_collection_exported`,
 *   `dispute_ops_note_added`, `dispute_waived_closed`, `dispute_reception_resolved`,
 *   `dispute_return_intake_opened` — contrôle retour : défaut / absence (litige)
 *   `return_reversible_defect_clemency` — défaut réversible : pas de facturation, modale commande
 *   `borrow_return_extended_ops` — prolongation BO (e-mail + push + SMS fallback)
 * **Litige item BO** (via `POST /api/internal/item-dispute-resolved-notify`)  
 * - `item_dispute_minor_warning`, `item_dispute_small_defect_charged`,
 *   `item_dispute_major_defect_charged`, `item_dispute_non_return_charged`
 * **Paiement Stripe litige pièce** (webhook / sync)  
 * - `item_dispute_invoice_paid` — deep link `/commande/[cartId]`
 *
 * **Engagement** (crons séparés, `SEGNA_NOTIFY_SMS_ALERTS=1`, max 2 SMS/jour Paris — emprunt prioritaire)  
 * - `onboarding_incomplete_reminder` — 15h Paris (`member-onboarding-reminders`)  
 * - `onboarding_incomplete_reminder_followup` — idem  
 * - `abandoned_cart_reminder` — 18h Paris (`member-abandoned-cart-reminders`)
 */
export const NotificationKind = {
  cartOrderPaid: "cart_order_paid",
  cartOrderN8nDeclared: "cart_order_n8n_declared",
  /** Nouveau compte membre → Discord / n8n (même webhook activité). */
  userRegisteredN8nDeclared: "user_registered_n8n_declared",
  /** Annulation BO avant expédition (aller encore « en préparation ») : e-mail + SMS transactionnel. */
  cartOrderCanceledBackofficePrep: "cart_order_canceled_backoffice_prep",
  /** Annulation membre (app) avant prise en charge transporteur : e-mail + SMS transactionnel. */
  cartOrderCanceledMember: "cart_order_canceled_member",
  walletCreditsStripe: "wallet_credits_stripe",
  subscriptionSegnaXWelcome: "subscription_segna_x_welcome",
  /** Annulation programmée fin de période (membre / webhook). */
  subscriptionCancelScheduled: "subscription_cancel_scheduled",
  orderOutboundReadyToShip: "order_outbound_ready_to_ship",
  orderOutboundTransitPartner: "order_outbound_transit_partner",
  orderOutboundRelayPickupReady: "order_outbound_relay_pickup_ready",
  orderOutboundDelivered: "order_outbound_delivered",
  returnMemberDroppedParcel: "return_member_dropped_parcel",
  returnExchangeComplete: "return_exchange_complete",
  returnReceivedBySegna: "return_received_by_segna",
  /** Contrôle retour BO OK (sans litige) — location terminée. */
  returnConfirmed: "return_confirmed",
  memberIntakeDroppedIn: "member_intake_dropped_in",
  borrowReturnDeadlineReminder: "borrow_return_deadline_reminder",
  borrowOverdueDaily: "borrow_overdue_daily",
  borrowFormalNoticeSent: "borrow_formal_notice_sent",
  borrowNonRestitutionInvoiced: "borrow_non_restitution_invoiced",
  /** Achat Guest : facture Stripe envoyée par e-mail après paiement confirmé. */
  guestPurchaseInvoiced: "guest_purchase_invoiced",
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
  /** Réponse staff / Discord sur le chatbot membre. */
  itemChatStaffMessage: "item_chat_staff_message",
  /** BO litige — réception hors circuit → reprise. */
  disputeReturnRecovered: "dispute_return_recovered",
  /** BO litige — suspension accès app. */
  disputeMemberAuthSuspended: "dispute_member_auth_suspended",
  /** BO litige — export dossier recouvrement. */
  disputeCollectionExported: "dispute_collection_exported",
  /** BO litige — note ops (mise à jour dossier). */
  disputeOpsNoteAdded: "dispute_ops_note_added",
  /** BO litige — grâce / abandon. */
  disputeWaivedClosed: "dispute_waived_closed",
  /** BO litige — clôture litige réception (résolu). */
  disputeReceptionResolved: "dispute_reception_resolved",
  /** Contrôle retour BO — défaut / absence constaté à la réception. */
  disputeReturnIntakeOpened: "dispute_return_intake_opened",
  /** Contrôle retour — défaut réversible (clémence, pas de litige / facturation). */
  returnReversibleDefectClemency: "return_reversible_defect_clemency",
  /** BO retard — prolongation d’échéance de retour (gratuite ops). */
  borrowReturnExtendedOps: "borrow_return_extended_ops",
  /** BO litige item — défaut minime (avertissement, 0 %). */
  itemDisputeMinorWarning: "item_dispute_minor_warning",
  /** BO litige item — petit défaut irréversible (30 %). */
  itemDisputeSmallDefectCharged: "item_dispute_small_defect_charged",
  /** BO litige item — gros défaut irréversible (50 %). */
  itemDisputeMajorDefectCharged: "item_dispute_major_defect_charged",
  /** BO litige item — non restitution (100 %). */
  itemDisputeNonReturnCharged: "item_dispute_non_return_charged",
  /** Paiement Stripe litige pièce reçu → litige clos, deep link commande. */
  itemDisputeInvoicePaid: "item_dispute_invoice_paid",
} as const;

export type NotificationKindId = (typeof NotificationKind)[keyof typeof NotificationKind];
