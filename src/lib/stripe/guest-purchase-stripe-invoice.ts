import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import StripeLib from "stripe";

import {
  fetchBorrowCartInvoiceLines,
  type BorrowCartInvoiceLine,
} from "@/lib/cart/fetch-borrow-cart-invoice-lines";
import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeCustomerForUser } from "@/lib/stripe/borrow-overdue-checkout";
import { notifyGuestPurchaseInvoiced } from "@/lib/notifications/guest-purchase-notify";
import { upsertCartOrderStripeInvoiceFromSession, upsertGuestPurchaseStripeInvoiceRecord, guestPurchaseInvoiceDownloadUrlFromStripeInvoice } from "@/lib/stripe/upsert-cart-order-stripe-invoice";

function stripeInvoiceEnabled(): boolean {
  return process.env.SEGNA_GUEST_PURCHASE_STRIPE_INVOICE !== "0";
}

function isDryRun(): boolean {
  return process.env.SEGNA_GUEST_PURCHASE_DRY_RUN === "1";
}

function shouldEmailStripeInvoiceAfterPayment(): boolean {
  return process.env.SEGNA_GUEST_PURCHASE_STRIPE_INVOICE_EMAIL !== "0";
}

/** Tax rate Stripe FR 20 % (montants TTC inclusifs). */
function resolveFrVat20TaxRateId(): string | null {
  const id = process.env.STRIPE_FR_VAT_20_TAX_RATE_ID?.trim();
  return id || null;
}

function guestPurchaseInvoiceItemTaxParams():
  | { tax_rates: string[]; tax_behavior: "inclusive" }
  | Record<string, never> {
  const taxRateId = resolveFrVat20TaxRateId();
  if (!taxRateId) return {};
  return { tax_rates: [taxRateId], tax_behavior: "inclusive" };
}

async function resolvePaymentIntentIdForGuestPurchaseInvoice(
  stripe: StripeLib,
  invoice: Stripe.Invoice,
): Promise<string | null> {
  const fromMetadata = invoice.metadata?.stripe_payment_intent_id?.trim();
  if (fromMetadata) return fromMetadata;

  const sessionId = invoice.metadata?.stripe_checkout_session_id?.trim();
  if (!sessionId) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (typeof session.payment_intent === "string") return session.payment_intent;
    if (
      session.payment_intent &&
      typeof session.payment_intent === "object" &&
      "id" in session.payment_intent
    ) {
      return String((session.payment_intent as { id: string }).id);
    }
  } catch (e) {
    console.error("[guest-purchase] resolve payment intent from checkout session", sessionId, e);
  }
  return null;
}

function resolvePurchaseItemLines(
  itemsCents: number,
  itemLines: BorrowCartInvoiceLine[],
): BorrowCartInvoiceLine[] {
  if (itemLines.length === 0) {
    return [{ label: "Achat Segna", valueCents: itemsCents }];
  }
  const sum = itemLines.reduce((acc, line) => acc + line.valueCents, 0);
  if (sum === itemsCents) return itemLines;
  return [{ label: "Achat Segna", valueCents: itemsCents }];
}

export function guestPurchaseShippingDescriptionFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string {
  const deliveryChannel = (metadata?.delivery_channel ?? "").trim().toLowerCase();
  const homeSpeed = (metadata?.home_speed ?? "").trim().toLowerCase();
  if (deliveryChannel === "relay") {
    const relay = (metadata?.relay_code ?? "").trim();
    return relay ? `Livraison point relais — ${relay.slice(0, 120)}` : "Livraison point relais (TTC)";
  }
  if (homeSpeed === "uber_direct") {
    return "Livraison à domicile express (Coursier.fr, TTC)";
  }
  return "Livraison à domicile (aller, TTC)";
}

/** Lignes Checkout Session achat Guest (1 ligne par pièce + port + service). */
export async function buildGuestPurchaseCheckoutLineItems(
  admin: SupabaseClient,
  params: {
    cartId: string;
    itemsCents: number;
    shippingTtcCents: number;
    shippingDescription: string;
    serviceTtcCents: number;
  },
): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
  let itemLines: BorrowCartInvoiceLine[] = [];
  try {
    itemLines = await fetchBorrowCartInvoiceLines(admin, params.cartId);
  } catch (e) {
    console.error("[guest-purchase] fetch cart lines for checkout", params.cartId, e);
  }
  const cartLines = resolvePurchaseItemLines(params.itemsCents, itemLines);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = cartLines.map((line) => ({
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: line.valueCents,
      product_data: {
        name: line.label.slice(0, 120),
        description: "Achat définitif",
      },
    },
  }));

  if (params.shippingTtcCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: params.shippingTtcCents,
        product_data: {
          name: "Livraison (aller, TTC)",
          description: params.shippingDescription.slice(0, 120),
        },
      },
    });
  }

  if (params.serviceTtcCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: params.serviceTtcCents,
        product_data: {
          name: "Frais de service (TTC)",
        },
      },
    });
  }

  return lineItems;
}

async function findGuestPurchaseInvoiceForCheckout(
  stripe: StripeLib,
  customerId: string,
  checkoutSessionId: string,
): Promise<Stripe.Invoice | null> {
  const page = await stripe.invoices.list({ customer: customerId, limit: 24, status: "paid" });
  return (
    page.data.find(
      (invoice) =>
        invoice.metadata?.source === "guest_purchase" &&
        invoice.metadata?.stripe_checkout_session_id === checkoutSessionId,
    ) ?? null
  );
}

async function findGuestPurchaseInvoiceForCart(
  stripe: StripeLib,
  customerId: string,
  cartId: string,
): Promise<Stripe.Invoice | null> {
  const page = await stripe.invoices.list({ customer: customerId, limit: 24, status: "paid" });
  return (
    page.data.find(
      (invoice) =>
        invoice.metadata?.source === "guest_purchase" &&
        invoice.metadata?.cart_id?.trim() === cartId,
    ) ?? null
  );
}

/** Checkout Session achat Guest : metadata ou lignes « Achat définitif ». */
export function checkoutSessionIsGuestPurchase(session: Stripe.Checkout.Session): boolean {
  if (session.metadata?.purchase_mode === "true") return true;
  if (session.metadata?.guest_cash_rental !== "true") return false;

  const lineItems = session.line_items?.data ?? [];
  for (const item of lineItems) {
    const product = item.price?.product;
    const productObj =
      product && typeof product === "object" && !Array.isArray(product)
        ? (product as Stripe.Product)
        : null;
    const desc = [item.description, productObj?.description, productObj?.name]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    if (/achat\s+d[eé]finitif/i.test(desc)) return true;
  }

  return false;
}

async function backfillCartCheckoutPurchaseMode(
  admin: SupabaseClient,
  cartId: string,
  userId: string,
): Promise<void> {
  try {
    await admin
      .from("carts")
      .update({ checkout_purchase_mode: true })
      .eq("id", cartId)
      .eq("user_id", userId);
  } catch (e) {
    console.error("[guest-purchase] checkout_purchase_mode backfill failed", cartId, e);
  }
}

async function syncGuestPurchaseStripeInvoiceFromPaidInvoice(
  admin: SupabaseClient,
  params: {
    cartId: string;
    userId: string;
    invoice: Stripe.Invoice;
    resendEmail?: boolean;
  },
): Promise<void> {
  const downloadUrl = guestPurchaseInvoiceDownloadUrlFromStripeInvoice(params.invoice);
  await upsertGuestPurchaseStripeInvoiceRecord(admin as never, {
    cartId: params.cartId,
    userId: params.userId,
    stripeInvoiceId: params.invoice.id,
    hostedUrl: downloadUrl,
  });
  await backfillCartCheckoutPurchaseMode(admin, params.cartId, params.userId);

  if (params.resendEmail !== false) {
    try {
      await sendGuestPurchaseStripeInvoiceEmailAfterPayment(admin, {
        invoiceId: params.invoice.id,
        cartId: params.cartId,
        userId: params.userId,
      });
    } catch (e) {
      console.error("[guest-purchase] resend invoice email after sync", params.invoice.id, e);
    }
  }
}

/** Enrichit la session Checkout (lignes « Achat définitif ») et force `purchase_mode` si besoin. */
export async function resolveGuestPurchaseCheckoutSession(
  stripe: StripeLib,
  session: Stripe.Checkout.Session,
): Promise<Stripe.Checkout.Session> {
  if (session.metadata?.purchase_mode === "true") return session;

  if (checkoutSessionIsGuestPurchase(session)) {
    return {
      ...session,
      metadata: {
        ...session.metadata,
        purchase_mode: "true",
      },
    };
  }

  if (session.metadata?.guest_cash_rental !== "true") return session;

  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  });
  if (!checkoutSessionIsGuestPurchase(expanded)) return session;

  return {
    ...expanded,
    metadata: {
      ...expanded.metadata,
      purchase_mode: "true",
    },
  };
}

/** Envoie la facture achat par e-mail Segna (idempotent). */
export async function sendGuestPurchaseStripeInvoiceEmailAfterPayment(
  admin: SupabaseClient,
  input: { invoiceId: string; cartId: string; userId: string; orderRef?: string },
): Promise<void> {
  if (!shouldEmailStripeInvoiceAfterPayment()) return;
  if (input.invoiceId.startsWith("dry_run_")) return;

  const stripe = new StripeLib(getStripeConfig().secretKey);
  const invoice = await stripe.invoices.retrieve(input.invoiceId);
  const totalCents =
    typeof invoice.amount_paid === "number"
      ? Math.trunc(invoice.amount_paid)
      : typeof invoice.total === "number"
        ? Math.trunc(invoice.total)
        : 0;
  const orderRef = input.orderRef ?? input.cartId.slice(0, 8).toUpperCase();
  const hostedUrl = guestPurchaseInvoiceDownloadUrlFromStripeInvoice(invoice);
  const paymentIntentId = await resolvePaymentIntentIdForGuestPurchaseInvoice(stripe, invoice);

  await upsertGuestPurchaseStripeInvoiceRecord(admin as never, {
    cartId: input.cartId,
    userId: input.userId,
    stripeInvoiceId: invoice.id,
    hostedUrl,
  });

  await notifyGuestPurchaseInvoiced(admin, {
    userId: input.userId,
    cartId: input.cartId,
    orderRef,
    totalCents,
    paymentIntentId,
    stripeInvoiceId: invoice.id,
  });
}

/**
 * Après Checkout Session payée : émet une facture Stripe (déjà réglée) et l'envoie par e-mail.
 * Le paiement passe par Checkout — pas par la page facture hébergée.
 */
export async function issueGuestPurchaseStripeInvoiceAfterCheckoutPayment(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<{ invoiceId: string | null; skipped?: boolean }> {
  if (!checkoutSessionIsGuestPurchase(session)) {
    return { invoiceId: null, skipped: true };
  }
  if (session.metadata?.checkout_kind !== "cart_order") {
    return { invoiceId: null, skipped: true };
  }
  if (session.payment_status !== "paid") {
    return { invoiceId: null, skipped: true };
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("guest_purchase: metadata cart_id manquant");
  }

  if (isDryRun()) {
    return { invoiceId: `dry_run_inv_purchase_${cartId.slice(0, 8)}`, skipped: false };
  }

  if (!stripeInvoiceEnabled()) {
    return { invoiceId: null, skipped: true };
  }

  const itemsCents = Math.max(0, Math.trunc(Number(session.metadata?.credits_line_cents ?? 0)));
  const shippingTtcCents = Math.max(0, Math.trunc(Number(session.metadata?.shipping_ttc_cents ?? 0)));
  const serviceTtcCents = Math.max(0, Math.trunc(Number(session.metadata?.service_ttc_cents ?? 0)));
  const totalCents = itemsCents + shippingTtcCents + serviceTtcCents;
  if (totalCents < 50) {
    return { invoiceId: null, skipped: true };
  }

  const stripe = new StripeLib(getStripeConfig().secretKey);
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : await ensureStripeCustomerForUser(admin, stripe, userId, null);

  const orderRef = cartId.slice(0, 8).toUpperCase();

  const existing = await findGuestPurchaseInvoiceForCheckout(stripe, customerId, session.id);
  if (existing) {
    const refreshed = await stripe.invoices.retrieve(existing.id);
    await upsertGuestPurchaseStripeInvoiceRecord(admin as never, {
      cartId,
      userId,
      stripeInvoiceId: refreshed.id,
      hostedUrl: guestPurchaseInvoiceDownloadUrlFromStripeInvoice(refreshed),
    });
    try {
      await sendGuestPurchaseStripeInvoiceEmailAfterPayment(admin, {
        invoiceId: existing.id,
        cartId,
        userId,
        orderRef,
      });
    } catch (e) {
      console.error("[guest-purchase] resend invoice email for existing", existing.id, e);
    }
    return { invoiceId: existing.id, skipped: true };
  }

  let itemLines: BorrowCartInvoiceLine[] = [];
  try {
    itemLines = await fetchBorrowCartInvoiceLines(admin, cartId);
  } catch (e) {
    console.error("[guest-purchase] fetch cart lines", cartId, e);
  }
  const cartLines = resolvePurchaseItemLines(itemsCents, itemLines);
  const shippingDescription = guestPurchaseShippingDescriptionFromMetadata(session.metadata);

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent && typeof session.payment_intent === "object" && "id" in session.payment_intent
        ? String((session.payment_intent as { id: string }).id)
        : "";

  const metadata: Record<string, string> = {
    source: "guest_purchase",
    purchase_mode: "true",
    paid_via: "checkout",
    stripe_checkout_session_id: session.id,
    ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
  };

  for (const [key, value] of Object.entries(session.metadata ?? {})) {
    if (typeof value === "string" && value.trim()) {
      metadata[key] = value.slice(0, 500);
    }
  }

  const idempotencyKey = `guest_purchase_invoice_post_checkout:${cartId}:${session.id}`;
  const invoiceItemTax = guestPurchaseInvoiceItemTaxParams();

  const invoice = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: "charge_automatically",
      auto_advance: false,
      pending_invoice_items_behavior: "exclude",
      description: `Segna — achat commande ${orderRef}`,
      metadata,
    },
    { idempotencyKey },
  );

  for (let i = 0; i < cartLines.length; i += 1) {
    const line = cartLines[i]!;
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: line.valueCents,
        currency: "eur",
        description: line.label,
        ...invoiceItemTax,
      },
      { idempotencyKey: `${idempotencyKey}:cart_line:${i}` },
    );
  }

  if (shippingTtcCents > 0) {
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: shippingTtcCents,
        currency: "eur",
        description: shippingDescription,
        ...invoiceItemTax,
      },
      { idempotencyKey: `${idempotencyKey}:shipping` },
    );
  }

  if (serviceTtcCents > 0) {
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: serviceTtcCents,
        currency: "eur",
        description: "Frais de service (TTC)",
        ...invoiceItemTax,
      },
      { idempotencyKey: `${idempotencyKey}:service` },
    );
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  const paid = await stripe.invoices.pay(finalized.id, { paid_out_of_band: true });
  const refreshed = await stripe.invoices.retrieve(paid.id);

  await upsertGuestPurchaseStripeInvoiceRecord(admin as never, {
    cartId,
    userId,
    stripeInvoiceId: refreshed.id,
    hostedUrl: guestPurchaseInvoiceDownloadUrlFromStripeInvoice(refreshed),
  });

  try {
    await sendGuestPurchaseStripeInvoiceEmailAfterPayment(admin, {
      invoiceId: refreshed.id,
      cartId,
      userId,
      orderRef,
    });
  } catch (e) {
    console.error("[guest-purchase] send invoice email after checkout", refreshed.id, e);
  }

  return { invoiceId: refreshed.id };
}

/**
 * Rattrapage : émet / synchronise la facture achat si le paiement Checkout est passé sans facture en base.
 */
export async function ensureGuestPurchaseStripeInvoiceForCartOrder(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
): Promise<void> {
  const stripe = new StripeLib(getStripeConfig().secretKey);

  const [{ data: cartRow }, { data: invoiceRow }, { data: debitRow }] = await Promise.all([
    admin
      .from("carts")
      .select("checkout_purchase_mode")
      .eq("id", cartId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("cart_order_stripe_invoices")
      .select(
        "guest_purchase_stripe_invoice_id, guest_purchase_stripe_invoice_hosted_url, checkout_session_id",
      )
      .eq("cart_id", cartId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("wallet_transactions")
      .select("metadata")
      .eq("user_id", userId)
      .eq("kind", "debit")
      .eq("direction", "debit")
      .filter("metadata->>source", "eq", "cart_order_stripe")
      .filter("metadata->>cart_id", "eq", cartId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const purchaseFromCart =
    (cartRow as { checkout_purchase_mode?: boolean | null } | null)?.checkout_purchase_mode === true;
  const storedInvoiceId = (
    (invoiceRow as { guest_purchase_stripe_invoice_id?: string | null } | null)
      ?.guest_purchase_stripe_invoice_id ?? ""
  ).trim();
  const hostedUrl = (
    (invoiceRow as { guest_purchase_stripe_invoice_hosted_url?: string | null } | null)
      ?.guest_purchase_stripe_invoice_hosted_url ?? ""
  ).trim();

  if (hostedUrl) {
    if (!purchaseFromCart) {
      await backfillCartCheckoutPurchaseMode(admin, cartId, userId);
    }
    return;
  }

  if (storedInvoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(storedInvoiceId);
      if (invoice.status === "paid" && invoice.metadata?.source === "guest_purchase") {
        await syncGuestPurchaseStripeInvoiceFromPaidInvoice(admin, {
          cartId,
          userId,
          invoice,
        });
        return;
      }
    } catch (e) {
      console.error("[guest-purchase] sync stored invoice id", storedInvoiceId, e);
    }
  }

  const debitMeta = (debitRow as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? null;
  const sessionIdRaw =
    typeof debitMeta?.stripe_checkout_session_id === "string"
      ? debitMeta.stripe_checkout_session_id.trim()
      : typeof (invoiceRow as { checkout_session_id?: string | null } | null)?.checkout_session_id ===
          "string"
        ? String((invoiceRow as { checkout_session_id: string }).checkout_session_id).trim()
        : "";

  const customerId = await ensureStripeCustomerForUser(admin, stripe, userId, null);
  const invoiceForCart = await findGuestPurchaseInvoiceForCart(stripe, customerId, cartId);
  if (invoiceForCart) {
    await syncGuestPurchaseStripeInvoiceFromPaidInvoice(admin, {
      cartId,
      userId,
      invoice: invoiceForCart,
    });
    return;
  }

  if (!sessionIdRaw || sessionIdRaw === "wallet_only") return;

  if (sessionIdRaw.startsWith("inv_")) {
    try {
      const invoice = await stripe.invoices.retrieve(sessionIdRaw.slice(4));
      if (invoice.status === "paid" && invoice.metadata?.source === "guest_purchase") {
        await syncGuestPurchaseStripeInvoiceFromPaidInvoice(admin, { cartId, userId, invoice });
      }
    } catch (e) {
      console.error("[guest-purchase] sync invoice checkout_session_id", cartId, e);
    }
    return;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionIdRaw, {
      expand: ["line_items.data.price.product"],
    });
  } catch (e) {
    console.error("[guest-purchase] retrieve checkout session", sessionIdRaw, e);
    return;
  }

  if (!checkoutSessionIsGuestPurchase(session) && !purchaseFromCart) return;

  if (!purchaseFromCart) {
    await backfillCartCheckoutPurchaseMode(admin, cartId, userId);
  }

  try {
    await upsertCartOrderStripeInvoiceFromSession(admin as never, session, userId);
  } catch (e) {
    console.error("[guest-purchase] upsert checkout invoice snapshot", cartId, e);
  }

  await issueGuestPurchaseStripeInvoiceAfterCheckoutPayment(admin, session, userId);
}
