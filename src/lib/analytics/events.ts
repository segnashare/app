/** PostHog custom events for Segna product funnels. */
export const ANALYTICS_EVENTS = {
  userSignedUp: "user_signed_up",
  authSignUpStarted: "auth_sign_up_started",
  onboardingSignupStepReached: "onboarding_signup_step_reached",
  phoneVerified: "phone_verified",
  onboardingCompleted: "onboarding_completed",
  cartCheckoutStarted: "cart_checkout_started",
  orderConfirmed: "order_confirmed",
  itemDraftStarted: "item_draft_started",
  itemSubmitted: "item_submitted",
  itemAvailable: "item_available",
  cartItemAdded: "cart_item_added",
  includedCreditsActivated: "included_credits_activated",
  onboardingInAppStepCompleted: "onboarding_in_app_step_completed",
  itemPriceConfirmed: "item_price_confirmed",
  referralQualified: "referral_qualified",
  orderReceived: "order_received",
  orderReturned: "order_returned",
  shopViewed: "shop_viewed",
  subscriptionCheckoutStarted: "subscription_checkout_started",
  subscriptionConfirmed: "subscription_confirmed",
  notificationSent: "notification_sent",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type OnboardingInAppStep =
  | "intro"
  | "profile"
  | "kyc"
  | "panier"
  | "offer"
  | "exchange"
  | "reward"
  | "finished";

export type AnalyticsEventProperties = {
  user_signed_up: {
    method: "email" | "oauth";
    referral_code_present?: boolean;
    provider?: string;
  };
  auth_sign_up_started: {
    method: "email" | "oauth";
    provider?: string;
  };
  onboarding_signup_step_reached: {
    step: string;
  };
  phone_verified: {
    surface: string;
  };
  onboarding_completed: {
    path: string;
  };
  cart_checkout_started: {
    cart_id: string;
    item_count?: number;
    already_reserved?: boolean;
    borrow_duration_days?: number;
    borrow_duration_label?: string;
  };
  order_confirmed: {
    cart_id: string;
    checkout_mode?: "stripe" | "wallet_setup" | "wallet_only" | "webhook";
    used_included_order?: boolean;
    item_count?: number;
    /** Total € encaissé (complément crédits + frais livraison/service), en centimes. 0 si wallet_only. */
    cash_paid_cents?: number;
    /** Valeur totale du panier en crédits d'échange (mods) débités du wallet. */
    cart_credits_mods?: number;
    /** Crédits (mods) achetés en complément € (si panier > solde wallet). */
    missing_credits_mods?: number;
    borrow_duration_days?: number;
    /** `7_jours` | `14_jours` | `1_mois` — breakdown PostHog */
    borrow_duration_label?: string;
  };
  item_draft_started: {
    item_id: string;
    is_new_draft?: boolean;
  };
  item_submitted: {
    item_id: string;
    photo_count?: number;
    onboarding_exchange_step?: boolean;
  };
  item_available: {
    item_id: string;
    owner_user_id?: string;
    source?: string;
  };
  cart_item_added: {
    item_id: string;
    cart_id?: string;
    source: string;
    trigger?: string;
  };
  included_credits_activated: {
    credits_granted?: number;
    included_credits_amount?: number;
    already_claimed?: boolean;
    source?: string;
  };
  onboarding_in_app_step_completed: {
    from_step: OnboardingInAppStep | string | null;
    to_step: OnboardingInAppStep | string;
    trigger: string;
  };
  item_price_confirmed: {
    item_id: string;
    surface: string;
  };
  referral_qualified: {
    referral_id?: string;
    referrer_user_id?: string;
    referred_user_id?: string;
    trigger?: string;
  };
  order_received: {
    cart_id: string;
    manual_confirm?: boolean;
    confirm_source?: "auto";
  };
  order_returned: {
    cart_id: string;
    phase: "return_initiated" | "return_feedback_submitted" | "return_received_segna";
  };
  shop_viewed: {
    source?: string;
  };
  subscription_checkout_started: {
    plan_code: string;
    trial_period_days?: number;
  };
  subscription_confirmed: {
    plan_code: string;
    checkout_mode?: "stripe" | "webhook" | "sync";
    stripe_session_id?: string;
  };
  notification_sent: {
    kind: string;
    channel: "sms";
    expected_goal_event: string;
    expected_goal_filter_property?: string;
    expected_goal_filter_value?: string | boolean | number;
    conversion_window_hours?: number;
    cart_id?: string;
    item_id?: string;
    idempotency_key?: string;
  };
};
