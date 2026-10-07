import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import StripeLib from "stripe";

import {
  checkoutSessionCustomerEmail,
  clubAmountLabel,
  clubWelcomeSmsBody,
  type ClubPlanCode,
} from "@/lib/notifications/club-subscription-messages";
import { clubSubscriptionReceiptEmailBlocks } from "@/lib/notifications/email-html";
import { buildMemberPushData, memberHasAuthorizedPush, sendExpoPushToUserResult } from "@/lib/notifications/expo-push-send";
import {
  claimNotificationSend,
  markPushChannelFailed,
  metadataMarksPushChannelFailed,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { missingTransactionalEmailSecrets, sendTransactionalEmail } from "@/lib/notifications/resend-send";
import type { TransactionalEmailAttachment } from "@/lib/notifications/resend-send";
import {
  formatMissingSmsSecrets,
  missingTransactionalSmsSecrets,
  sendTransactionalSms,
} from "@/lib/notifications/twilio-send";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { getStripeConfig } from "@/lib/social/stripe";
import { fetchStripeInvoicePdfBuffer } from "@/lib/stripe/fetch-stripe-invoice-pdf";
import { getMappedPlanCodeFromSubscription } from "@/lib/stripe/subscription-state";

export { checkoutSessionCustomerEmail };

export const SUBSCRIPTION_WELCOME_PUSH_BODY = "Tu as rejoint le club !";

function isSubscriptionWelcomePlan(
  value: string | null | undefined,
): value is ClubPlanCode | "segna_x" | "segna_plus" {
  return value === "club" || value === "club_plus" || value === "segna_x" || value === "segna_plus";
}

function spotlightPlanForWelcome(planCode: string): "segna_plus" | "segna_x" {
  return planCode === "segna_plus" || planCode === "club_plus" ? "segna_plus" : "segna_x";
}

/** Une bienvenue par facture payée, pas par abonnement Stripe. Un réabonnement après annulation a une nouvelle facture. */
function welcomeInvoiceId(subscription: Stripe.Subscription): string | null {
  const invoice = subscription.latest_invoice;
  if (typeof invoice === "string" && invoice.trim()) return invoice.trim();
  if (invoice && typeof invoice === "object" && "id" in invoice && typeof invoice.id === "string") {
    const id = invoice.id.trim();
    return id || null;
  }
  return null;
}

function welcomeSendKey(
  prefix: string,
  subscription: Stripe.Subscription,
  explicitInvoiceId?: string | null,
): string {
  const invoiceId = explicitInvoiceId?.trim() || welcomeInvoiceId(subscription);
  return invoiceId ? `${prefix}:${subscription.id}:${invoiceId}` : `${prefix}:${subscription.id}`;
}

function emailPlanCode(planCode: string): ClubPlanCode {
  return planCode === "club_plus" || planCode === "segna_plus" ? "club_plus" : "club";
}

async function loadUserContact(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("users").select("email, phone, first_name").eq("id", userId).maybeSingle();

  if (error) {
    console.error("[notifications] loadUserContact (subscription)", error.message);
    return null;
  }
  return data;
}

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

function setupIntentStatusBlocks(status: string | null | undefined): boolean {
  return status !== "succeeded" && status !== "canceled";
}

/**
 * Un `pending_setup_intent` laissé en id string ne doit pas avaler la bienvenue :
 * on lit le statut réel. Sans client Stripe, on ne bloque pas.
 */
async function setupIntentBlocksWelcome(
  subscription: Stripe.Subscription,
  stripe?: Stripe,
): Promise<boolean> {
  const value = subscription.pending_setup_intent;
  if (!value) return false;
  if (typeof value === "object") return setupIntentStatusBlocks(value.status);
  if (!stripe) return false;
  try {
    const intent = await stripe.setupIntents.retrieve(value);
    return setupIntentStatusBlocks(intent.status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[notifications] subscription welcome: setup intent retrieve failed", msg);
    return false;
  }
}

function invoiceIsPaid(invoice: Stripe.Invoice): boolean {
  return invoice.status === "paid";
}

/** Renouvellement mensuel : pas une nouvelle bienvenue. Un réabonnement crée une facture `subscription_create`. */
function invoiceIsInitialSubscriptionPayment(invoice: Stripe.Invoice): boolean {
  const reason = invoice.billing_reason;
  if (!reason) return true;
  return reason === "subscription_create";
}

async function invoiceForWelcomeDecision(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  paidInvoiceId?: string | null,
): Promise<Stripe.Invoice | null> {
  const hinted = paidInvoiceId?.trim() || "";
  const current = subscription.latest_invoice;
  if (
    hinted &&
    !(current && typeof current === "object" && !("deleted" in current && current.deleted) && current.id === hinted)
  ) {
    try {
      return await stripe.invoices.retrieve(hinted);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notifications] subscription welcome: hinted invoice retrieve failed", msg);
    }
  }
  if (current && typeof current === "object" && !("deleted" in current && current.deleted)) {
    return current;
  }
  const invoiceId = typeof current === "string" ? current : hinted;
  if (!invoiceId) return null;
  try {
    return await stripe.invoices.retrieve(invoiceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[notifications] subscription welcome: invoice retrieve failed", msg);
    return null;
  }
}

/**
 * La bienvenue ne doit partir qu’après encaissement (ou facture 0 € réellement close),
 * pas à la création Payment Sheet (`incomplete` / setup encore ouvert).
 */
export async function subscriptionHasCollectedWelcomePayment(
  subscription: Stripe.Subscription,
  stripe?: Stripe,
): Promise<boolean> {
  if (subscription.status !== "active" && subscription.status !== "trialing") return false;
  if (await setupIntentBlocksWelcome(subscription, stripe)) return false;

  let invoice = subscription.latest_invoice;
  if (typeof invoice === "string" && stripe) {
    try {
      invoice = await stripe.invoices.retrieve(invoice);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notifications] subscription welcome: invoice retrieve failed", msg);
      return false;
    }
  }
  if (invoice && typeof invoice === "object" && !("deleted" in invoice && invoice.deleted)) {
    return invoiceIsPaid(invoice);
  }
  return false;
}

function invoicePdfFilename(invoice: Stripe.Invoice): string {
  const raw = (typeof invoice.number === "string" && invoice.number.trim()) || invoice.id || "abonnement";
  const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
  return `facture-segna-${safe}.pdf`;
}

function invoiceAmountCents(invoice: Stripe.Invoice): number | null {
  if (typeof invoice.amount_paid === "number" && Number.isFinite(invoice.amount_paid)) {
    return Math.trunc(invoice.amount_paid);
  }
  if (typeof invoice.total === "number" && Number.isFinite(invoice.total)) {
    return Math.trunc(invoice.total);
  }
  return null;
}

function chargeIdFromExpandable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: string }).id).trim();
  }
  return "";
}

async function receiptUrlForPaidInvoice(stripe: Stripe, invoice: Stripe.Invoice): Promise<string | null> {
  const payments = invoice.payments?.data ?? [];
  for (const payment of payments) {
    const charge = payment.payment?.charge;
    if (charge && typeof charge === "object" && "receipt_url" in charge) {
      const url = (charge as Stripe.Charge).receipt_url?.trim();
      if (url) return url;
    }
  }
  let chargeId = "";
  for (const payment of payments) {
    chargeId = chargeIdFromExpandable(payment.payment?.charge);
    if (chargeId) break;
  }
  if (!chargeId) {
    chargeId = chargeIdFromExpandable((invoice as { charge?: unknown }).charge);
  }
  const legacyCharge = (invoice as { charge?: unknown }).charge;
  if (
    legacyCharge &&
    typeof legacyCharge === "object" &&
    "receipt_url" in legacyCharge &&
    typeof (legacyCharge as Stripe.Charge).receipt_url === "string"
  ) {
    const url = (legacyCharge as Stripe.Charge).receipt_url?.trim();
    if (url) return url;
  }
  if (!chargeId) return null;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    return charge.receipt_url?.trim() || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[notifications] subscription receipt_url", msg);
    return null;
  }
}

async function resolveSubscriptionInvoiceForWelcome(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<{
  pdf: Buffer | null;
  hostedUrl: string | null;
  receiptUrl: string | null;
  amountCents: number | null;
  filename: string;
}> {
  const empty = {
    pdf: null,
    hostedUrl: null,
    receiptUrl: null,
    amountCents: null,
    filename: "facture-segna-abonnement.pdf",
  };
  let invoice = subscription.latest_invoice;
  const invoiceId =
    typeof invoice === "string"
      ? invoice
      : invoice && typeof invoice === "object" && "id" in invoice
        ? invoice.id
        : "";
  const objectMissingDocument =
    invoice &&
    typeof invoice === "object" &&
    !("deleted" in invoice && invoice.deleted) &&
    !invoice.hosted_invoice_url?.trim() &&
    !invoice.invoice_pdf?.trim();
  if ((typeof invoice === "string" || objectMissingDocument) && invoiceId) {
    try {
      invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
    } catch {
      try {
        invoice = await stripe.invoices.retrieve(invoiceId);
      } catch (retryError) {
        const msg = retryError instanceof Error ? retryError.message : String(retryError);
        console.warn("[notifications] subscription welcome: invoice retrieve failed", msg);
        return empty;
      }
    }
  }
  if (!invoice || typeof invoice !== "object" || ("deleted" in invoice && invoice.deleted)) {
    return empty;
  }
  const hostedUrl = invoice.hosted_invoice_url?.trim() || null;
  const pdfUrl = invoice.invoice_pdf?.trim() || "";
  const pdf = pdfUrl ? await fetchStripeInvoicePdfBuffer(pdfUrl) : null;
  const receiptUrl = hostedUrl ? null : await receiptUrlForPaidInvoice(stripe, invoice);
  return {
    pdf,
    hostedUrl,
    receiptUrl,
    amountCents: invoiceAmountCents(invoice),
    filename: invoicePdfFilename(invoice),
  };
}

export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (direct && typeof direct === "object" && typeof direct.id === "string" && direct.id.trim()) {
    return direct.id.trim();
  }
  const parent = invoice.parent;
  const fromParent =
    parent && typeof parent === "object"
      ? (parent as { subscription_details?: { subscription?: string | { id?: string } } })
          .subscription_details?.subscription
      : null;
  if (typeof fromParent === "string" && fromParent.trim()) return fromParent.trim();
  if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string") {
    return fromParent.id.trim() || null;
  }
  return null;
}

type SubscriptionWelcomeOptions = {
  stripe?: Stripe;
  checkoutPaymentStatus?: Stripe.Checkout.Session.PaymentStatus | null;
  invoiceAlreadyPaid?: boolean;
  /** Facture encaissée (webhook `invoice.paid`). Prime sur `latest_invoice` pour l’idempotence. */
  paidInvoiceId?: string | null;
  customerEmail?: string | null;
  amountCents?: number | null;
};

/**
 * Ancien e-mail « Bienvenue dans Segna X » (clé = id d’abonnement seulement).
 * Délègue au reçu Club / Club+ pour ne pas envoyer un second mail sur la même facture.
 */
export async function notifySegnaXSubscriptionWelcomeIfApplicable(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  options?: SubscriptionWelcomeOptions,
): Promise<void> {
  await notifyClubSubscriptionWelcomeIfApplicable(admin, userId, subscription, options);
}

function subscriptionPriceAmountCents(subscription: Stripe.Subscription): number | null {
  const item = subscription.items.data[0];
  const unit = item?.price?.unit_amount;
  if (typeof unit !== "number" || !Number.isFinite(unit)) return null;
  const quantity = item?.quantity ?? 1;
  return Math.trunc(unit * quantity);
}

async function loadStripeCustomer(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<Stripe.Customer | null> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return null;
    return customer;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[notifications] club welcome: customer retrieve failed", msg);
    return null;
  }
}

async function loadProfilePhoneE164(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("user_profiles")
    .select("profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[notifications] club welcome profile phone", error.message);
    return null;
  }
  const profile = ((data?.profile_data ?? {}) as Record<string, unknown>) ?? {};
  const raw =
    (typeof profile.phone_e164 === "string" && profile.phone_e164) ||
    (typeof profile.phone === "string" && profile.phone) ||
    null;
  return tryNormalizePhoneToE164(raw);
}

function looksLikeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

/**
 * Bienvenue abonnement (club, club_plus, segna_x, segna_plus), après encaissement.
 * Un e-mail de reçu, puis un seul message direct : push si les notifs sont
 * autorisées, sinon SMS. Une fois par facture.
 */
export async function notifyClubSubscriptionWelcomeIfApplicable(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  options?: SubscriptionWelcomeOptions,
): Promise<void> {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  if (!isSubscriptionWelcomePlan(planCode)) return;
  if (subscription.status !== "active" && subscription.status !== "trialing") return;

  const checkoutStatus = options?.checkoutPaymentStatus;
  if (checkoutStatus && checkoutStatus !== "paid" && checkoutStatus !== "no_payment_required") {
    return;
  }

  const stripe = options?.stripe ?? new StripeLib(getStripeConfig().secretKey);
  if (!options?.invoiceAlreadyPaid && (await setupIntentBlocksWelcome(subscription, stripe))) return;
  const paid =
    options?.invoiceAlreadyPaid === true ||
    (await subscriptionHasCollectedWelcomePayment(subscription, stripe));
  if (!paid) return;
  const welcomeInvoice = await invoiceForWelcomeDecision(stripe, subscription, options?.paidInvoiceId);
  if (welcomeInvoice && !invoiceIsInitialSubscriptionPayment(welcomeInvoice)) return;
  try {
    await deliverClubSubscriptionReceipt(admin, userId, subscription, planCode, stripe, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] club receipt failed", msg);
  }
  try {
    await deliverClubWelcomePushOrSms(admin, userId, subscription, planCode, stripe, options?.paidInvoiceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] club welcome push/sms failed", msg);
  }
}

async function deliverClubSubscriptionReceipt(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  planCode: string,
  stripe: Stripe,
  options?: SubscriptionWelcomeOptions,
): Promise<void> {
  const missingEmail = missingTransactionalEmailSecrets();
  if (missingEmail.length > 0) {
    console.warn(
      `[notifications] club receipt non envoyé : secret manquant ${missingEmail.join(", ")}`,
    );
    return;
  }

  const [user, stripeCustomer, invoice] = await Promise.all([
    loadUserContact(admin, userId),
    loadStripeCustomer(stripe, subscription),
    resolveSubscriptionInvoiceForWelcome(stripe, subscription),
  ]);
  const email =
    looksLikeEmail(options?.customerEmail) ||
    looksLikeEmail(stripeCustomer?.email) ||
    looksLikeEmail(user?.email);
  if (!email) {
    console.warn("[notifications] club receipt: pas d’e-mail", { userId, subscriptionId: subscription.id });
    return;
  }

  const sessionAmount =
    typeof options?.amountCents === "number" && Number.isFinite(options.amountCents)
      ? Math.trunc(options.amountCents)
      : null;
  const amountCents =
    sessionAmount != null && sessionAmount > 0
      ? sessionAmount
      : typeof invoice.amountCents === "number"
        ? invoice.amountCents
        : sessionAmount ?? subscriptionPriceAmountCents(subscription);
  const documentUrl = invoice.hostedUrl || invoice.receiptUrl;
  if (!documentUrl && !invoice.pdf) {
    console.warn("[notifications] club receipt: facture Stripe pas encore disponible, envoi sans pièce", {
      userId,
      subscriptionId: subscription.id,
    });
  }

  const displayPlan = emailPlanCode(planCode);
  const idempotencyKey = welcomeSendKey(
    "txn:subscription_club_receipt",
    subscription,
    options?.paidInvoiceId,
  );
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionClubReceipt,
    userId,
    metadata: {
      stripe_subscription_id: subscription.id,
      stripe_invoice_id: options?.paidInvoiceId ?? welcomeInvoiceId(subscription),
      plan_code: planCode,
      status: subscription.status,
    },
  });
  if (!claimed) return;

  try {
    const prenom = firstNameOrBonjour(user?.first_name ?? null);
    const { subject, text, html } = clubSubscriptionReceiptEmailBlocks(prenom, {
      plan: displayPlan,
      amountLabel: clubAmountLabel(amountCents),
      receiptUrl: documentUrl,
      invoiceAttached: Boolean(invoice.pdf),
    });
    const attachments: TransactionalEmailAttachment[] | undefined = invoice.pdf
      ? [
          {
            filename: invoice.filename,
            content: invoice.pdf,
            contentType: "application/pdf",
          },
        ]
      : undefined;

    const sent = await sendTransactionalEmail({
      to: email,
      subject,
      text,
      html,
      idempotencyKey,
      attachments,
    });
    if (!sent) {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "email");
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] club receipt send failed", msg);
  }
}

/** Claim push laissé en `none` après un crash : on le relâche pour réessayer. */
const STALE_UNSENT_PUSH_CLAIM_MS = 2 * 60 * 1000;

function welcomeDirectWasSent(channels: unknown): boolean {
  return typeof channels === "string" && channels.length > 0 && channels !== "none";
}

/** `holds` : ce canal est déjà parti, en cours, ou le push a échoué — pas l’autre canal. */
async function welcomeDirectClaimState(
  admin: SupabaseClient,
  idempotencyKey: string,
): Promise<"absent" | "holds"> {
  const { data, error } = await admin
    .from("notification_send_log")
    .select("delivery_channels, metadata, created_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) {
    console.error("[notifications] welcome direct claim", error.message);
    return "holds";
  }
  if (!data) return "absent";
  if (welcomeDirectWasSent(data.delivery_channels) || metadataMarksPushChannelFailed(data.metadata)) {
    return "holds";
  }
  const createdMs = typeof data.created_at === "string" ? Date.parse(data.created_at) : NaN;
  if (!Number.isFinite(createdMs) || Date.now() - createdMs < STALE_UNSENT_PUSH_CLAIM_MS) {
    return "holds";
  }
  await releaseNotificationSend(admin, idempotencyKey);
  return "absent";
}

/**
 * Un seul canal : push si autorisé, SMS sinon.
 * Push autorisé mais plus de jeton au moment de l’envoi → SMS.
 * Push autorisé et échec Expo → pas de SMS (même si le jeton est ensuite désactivé).
 */
async function deliverClubWelcomePushOrSms(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  planCode: string,
  stripe: Stripe,
  paidInvoiceId?: string | null,
): Promise<void> {
  const pushKey = welcomeSendKey("txn:subscription_welcome_push", subscription, paidInvoiceId);
  const smsKey = welcomeSendKey("txn:subscription_club_welcome_sms", subscription, paidInvoiceId);
  if ((await welcomeDirectClaimState(admin, pushKey)) === "holds") return;
  if ((await welcomeDirectClaimState(admin, smsKey)) === "holds") return;

  const authorized = await memberHasAuthorizedPush(admin, userId);
  if (!authorized) {
    await deliverClubWelcomeSms(admin, userId, subscription, planCode, stripe, paidInvoiceId);
    return;
  }

  const outcome = await deliverSubscriptionWelcomePush(admin, userId, subscription, planCode, paidInvoiceId);
  if (outcome === "no_token") {
    await deliverClubWelcomeSms(admin, userId, subscription, planCode, stripe, paidInvoiceId);
  }
}

async function deliverSubscriptionWelcomePush(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  planCode: string,
  paidInvoiceId?: string | null,
): Promise<"sent" | "no_token" | "failed" | "blocked"> {
  const plan = spotlightPlanForWelcome(planCode);
  const walletEuros = plan === "segna_plus" ? 500 : 300;
  const idempotencyKey = welcomeSendKey("txn:subscription_welcome_push", subscription, paidInvoiceId);
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionSegnaXWelcome,
    userId,
    metadata: {
      stripe_subscription_id: subscription.id,
      plan_code: plan,
      wallet_euros: walletEuros,
      open_exchange_wallet: true,
    },
  });
  if (!claimed) return "blocked";

  try {
    const sent = await sendExpoPushToUserResult(admin, userId, {
      title: plan === "segna_plus" ? "Bienvenue au Club+" : "Bienvenue au Club",
      body: SUBSCRIPTION_WELCOME_PUSH_BODY,
      data: buildMemberPushData({
        kind: NotificationKind.subscriptionSegnaXWelcome,
        metadata: {
          open_exchange_wallet: true,
          plan_code: plan,
          wallet_euros: walletEuros,
        },
      }),
    });
    if (!sent.ok) {
      if (sent.reason === "no_token") {
        await releaseNotificationSend(admin, idempotencyKey);
        return "no_token";
      }
      await markPushChannelFailed(admin, idempotencyKey);
      console.warn("[notifications] subscription welcome push failed, pas de SMS", { userId });
      return "failed";
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "push");
    return "sent";
  } catch (e) {
    await markPushChannelFailed(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] subscription welcome push failed", msg);
    return "failed";
  }
}

async function deliverClubWelcomeSms(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  planCode: string,
  stripe: Stripe,
  paidInvoiceId?: string | null,
): Promise<void> {
  const missingSms = missingTransactionalSmsSecrets();
  if (missingSms.length > 0) {
    console.warn(
      `[notifications] club welcome sms non envoyé : secret manquant ${formatMissingSmsSecrets(missingSms)}`,
    );
    return;
  }

  const [user, stripeCustomer] = await Promise.all([
    loadUserContact(admin, userId),
    loadStripeCustomer(stripe, subscription),
  ]);
  const phoneE164 =
    tryNormalizePhoneToE164(stripeCustomer?.phone) ||
    tryNormalizePhoneToE164(user?.phone) ||
    (await loadProfilePhoneE164(admin, userId));
  if (!phoneE164) {
    console.warn("[notifications] club welcome sms: pas de téléphone", {
      userId,
      subscriptionId: subscription.id,
    });
    return;
  }

  const idempotencyKey = welcomeSendKey("txn:subscription_club_welcome_sms", subscription, paidInvoiceId);
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionClubWelcomeSms,
    userId,
    metadata: {
      stripe_subscription_id: subscription.id,
      plan_code: planCode,
    },
  });
  if (!claimed) return;

  try {
    const sent = await sendTransactionalSms({
      toE164: phoneE164,
      body: clubWelcomeSmsBody(planCode).slice(0, 320),
    });
    if (!sent) {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "phone");
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] club welcome sms send failed", msg);
  }
}
