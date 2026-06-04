/**
 * Backfill : rattache la carte du dernier paiement commande (PaymentIntent) au client Stripe,
 * pour les prélèvements off-session (pénalités retard emprunt).
 *
 * À lancer après le déploiement de `setup_future_usage` sur les Checkout commande / prolongation.
 *
 * Usage:
 *   node scripts/backfill-stripe-customer-payment-methods.mjs --dry-run
 *   node scripts/backfill-stripe-customer-payment-methods.mjs
 *   node scripts/backfill-stripe-customer-payment-methods.mjs --user-id=<uuid>
 *   node scripts/backfill-stripe-customer-payment-methods.mjs --force
 *
 * Options:
 *   --dry-run     Affiche les actions sans appeler Stripe (sauf lecture client si besoin)
 *   --user-id=    Un seul membre
 *   --force       Met à jour le moyen de paiement par défaut même si une carte existe déjà
 *   --limit=N     Traite au plus N membres (après déduplication)
 *
 * Env (.env.local) : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY, STRIPE_SECRET_KEY
 *
 * Après backfill, relancer le règlement des pénalités en attente :
 *   npm run cron:dev:borrow-overdue
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnvFile(relPath) {
  const full = path.join(__dirname, "..", relPath);
  if (!fs.existsSync(full)) return {};
  const out = {};
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, userId: null, limit: null };
  for (const raw of argv) {
    if (raw === "--dry-run") opts.dryRun = true;
    else if (raw === "--force") opts.force = true;
    else if (raw.startsWith("--user-id=")) opts.userId = raw.slice("--user-id=".length).trim();
    else if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    } else if (raw === "--help" || raw === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 22).join("\n"));
      process.exit(0);
    } else {
      console.error(`Option inconnue: ${raw}`);
      process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
const stripeSecret = (env.STRIPE_SECRET_KEY || "").trim();

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  process.exit(1);
}
if (!stripeSecret && !opts.dryRun) {
  console.error("Missing STRIPE_SECRET_KEY (requis sauf avec --dry-run)");
  process.exit(1);
}

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${typeof body === "object" ? JSON.stringify(body) : body}`);
  }
  return body;
}

function resolvePaymentMethodId(paymentIntent) {
  const pm = paymentIntent.payment_method;
  if (typeof pm === "string") return pm.trim() || null;
  if (pm && typeof pm === "object" && pm.id) return String(pm.id).trim() || null;
  return null;
}

async function customerHasCard(stripe, customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return { ok: false, reason: "customer_deleted" };
  const defaultPm = customer.invoice_settings?.default_payment_method;
  if (defaultPm) return { ok: true, hasCard: true, source: "default" };
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  if (pms.data.length > 0) return { ok: true, hasCard: true, source: "list" };
  return { ok: true, hasCard: false };
}

async function persistPaymentMethod(stripe, customerId, paymentIntentId, dryRun) {
  if (dryRun) {
    return { ok: true, dryRun: true, paymentIntentId };
  }

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const paymentMethodId = resolvePaymentMethodId(pi);
  if (!paymentMethodId) {
    return { ok: false, error: "no_payment_method_on_intent" };
  }

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const attached =
    typeof pm.customer === "string"
      ? pm.customer
      : pm.customer && typeof pm.customer === "object"
        ? pm.customer.id
        : null;

  if (!attached) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  } else if (attached !== customerId) {
    return { ok: false, error: "payment_method_other_customer" };
  }

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  return { ok: true, paymentMethodId, paymentIntentId };
}

async function fetchLatestInvoiceByUser() {
  let query =
    "cart_order_stripe_invoices?select=user_id,payment_intent_id,cart_id,created_at&payment_intent_id=not.is.null&order=created_at.desc";
  if (opts.userId) {
    query += `&user_id=eq.${opts.userId}`;
  }

  const rows = await rest(query);
  const byUser = new Map();
  for (const row of rows ?? []) {
    const userId = String(row.user_id ?? "").trim();
    const paymentIntentId = String(row.payment_intent_id ?? "").trim();
    if (!userId || !paymentIntentId) continue;
    if (!byUser.has(userId)) {
      byUser.set(userId, {
        userId,
        paymentIntentId,
        cartId: row.cart_id,
        createdAt: row.created_at,
      });
    }
  }
  let list = [...byUser.values()];
  if (opts.limit != null) list = list.slice(0, opts.limit);
  return list;
}

async function fetchBillingCustomerByUserId(userIds) {
  if (userIds.length === 0) return new Map();
  const idsFilter = `(${userIds.join(",")})`;
  const rows = await rest(
    `billing_customers?select=user_id,provider_customer_id&provider=eq.stripe&user_id=in.${idsFilter}`,
  );
  const map = new Map();
  for (const row of rows ?? []) {
    const uid = String(row.user_id ?? "").trim();
    const cid = String(row.provider_customer_id ?? "").trim();
    if (uid && cid) map.set(uid, cid);
  }
  return map;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Backfill Stripe — moyen de paiement par défaut");
  console.log("Mode:", opts.dryRun ? "DRY-RUN" : "LIVE");
  if (opts.force) console.log("Force: oui (écrase le défaut existant)");
  if (opts.userId) console.log("Filtre user:", opts.userId);

  const invoices = await fetchLatestInvoiceByUser();
  console.log(`Membres avec facture commande Stripe: ${invoices.length}`);
  if (invoices.length === 0) {
    console.log("Rien à faire.");
    return;
  }

  const billingByUser = await fetchBillingCustomerByUserId(invoices.map((i) => i.userId));
  const stripe = opts.dryRun ? null : new Stripe(stripeSecret);

  const stats = {
    skipped_no_billing: 0,
    skipped_has_card: 0,
    updated: 0,
    failed: 0,
  };

  for (const inv of invoices) {
    const customerId = billingByUser.get(inv.userId);
    if (!customerId) {
      stats.skipped_no_billing++;
      console.log(`[skip] ${inv.userId} — pas de billing_customers Stripe`);
      continue;
    }

    if (!opts.force && stripe) {
      try {
        const cardState = await customerHasCard(stripe, customerId);
        if (!cardState.ok) {
          stats.failed++;
          console.log(`[fail] ${inv.userId} — ${cardState.reason}`);
          continue;
        }
        if (cardState.hasCard) {
          stats.skipped_has_card++;
          console.log(`[skip] ${inv.userId} — carte déjà présente (${cardState.source})`);
          continue;
        }
      } catch (e) {
        stats.failed++;
        console.log(`[fail] ${inv.userId} — ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    const label = `cart ${inv.cartId} · PI ${inv.paymentIntentId.slice(0, 20)}…`;
    if (opts.dryRun) {
      stats.updated++;
      console.log(`[dry-run] ${inv.userId} — ${label} → customer ${customerId}`);
      continue;
    }

    try {
      const result = await persistPaymentMethod(stripe, customerId, inv.paymentIntentId, false);
      if (result.ok) {
        stats.updated++;
        console.log(`[ok] ${inv.userId} — ${label} → PM ${result.paymentMethodId}`);
      } else {
        stats.failed++;
        console.log(`[fail] ${inv.userId} — ${result.error}`);
      }
    } catch (e) {
      stats.failed++;
      console.log(`[fail] ${inv.userId} — ${e instanceof Error ? e.message : String(e)}`);
    }

    await sleep(120);
  }

  console.log("\nRésumé:", stats);
  if (!opts.dryRun && stats.updated > 0) {
    console.log("\nÉtape suivante : npm run cron:dev:borrow-overdue");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
