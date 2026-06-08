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
 *   node scripts/backfill-stripe-customer-payment-methods.mjs --env-file=.env.production.local --user-id=<uuid>
 *   node scripts/backfill-stripe-customer-payment-methods.mjs --payment-intent=pi_xxx --stripe-customer=cus_xxx
 *
 * Options:
 *   --dry-run     Affiche les actions sans appeler Stripe (sauf lecture client si besoin)
 *   --env-file=   Fichier env (ex. .env.production.local) — prioritaire sur .env.local
 *   --user-id=    Un seul membre (lit cart_order_stripe_invoices sur Supabase)
 *   --payment-intent= + --stripe-customer=  Backfill direct sans Supabase
 *   --force       Met à jour le moyen de paiement par défaut même si une carte existe déjà
 *   --limit=N     Traite au plus N membres (après déduplication)
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY, STRIPE_SECRET_KEY
 * (vercel env pull laisse souvent les secrets vides — copier STRIPE + Supabase depuis le dashboard Vercel)
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
  const opts = {
    dryRun: false,
    force: false,
    userId: null,
    limit: null,
    envFile: null,
    paymentIntentId: null,
    stripeCustomerId: null,
  };
  for (const raw of argv) {
    if (raw === "--dry-run") opts.dryRun = true;
    else if (raw === "--force") opts.force = true;
    else if (raw.startsWith("--user-id=")) opts.userId = raw.slice("--user-id=".length).trim();
    else if (raw.startsWith("--env-file=")) opts.envFile = raw.slice("--env-file=".length).trim();
    else if (raw.startsWith("--payment-intent=")) {
      opts.paymentIntentId = raw.slice("--payment-intent=".length).trim();
    } else if (raw.startsWith("--stripe-customer=")) {
      opts.stripeCustomerId = raw.slice("--stripe-customer=".length).trim();
    } else if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    } else if (raw === "--help" || raw === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 28).join("\n"));
      process.exit(0);
    } else {
      console.error(`Option inconnue: ${raw}`);
      process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const envFileLayers = opts.envFile ? [opts.envFile] : [".env.local", ".env"];
const env = {
  ...Object.assign({}, ...envFileLayers.map((f) => loadDotEnvFile(f))),
  ...process.env,
};
const directMode = Boolean(opts.paymentIntentId || opts.stripeCustomerId);
if (directMode && (!opts.paymentIntentId || !opts.stripeCustomerId)) {
  console.error("Mode direct : fournir --payment-intent= et --stripe-customer= ensemble.");
  process.exit(1);
}

const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
const stripeSecret = (env.STRIPE_SECRET_KEY || "").trim();

if (!directMode && (!supabaseUrl || !supabaseKey)) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY",
  );
  console.error(
    "Astuce : vercel env pull laisse souvent les secrets vides — copie-les depuis Vercel → Settings → Environment Variables (Production).",
  );
  process.exit(1);
}
if (!stripeSecret && !opts.dryRun) {
  console.error("Missing STRIPE_SECRET_KEY (requis sauf avec --dry-run)");
  process.exit(1);
}

function supabaseHostLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "(non configuré)";
  }
}

function stripeModeLabel(secret) {
  if (!secret) return "(absent)";
  if (secret.startsWith("sk_live_")) return "Stripe LIVE";
  if (secret.startsWith("sk_test_")) return "Stripe TEST";
  return "Stripe (mode inconnu)";
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

async function setCustomerDefaultPaymentMethod(stripe, customerId, paymentMethodId) {
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

async function persistPaymentMethodFromExistingCustomerCards(stripe, customerId) {
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 });
  const pmId = pms.data[0]?.id ?? null;
  if (!pmId) return { ok: false, error: "no_card_on_customer" };
  await setCustomerDefaultPaymentMethod(stripe, customerId, pmId);
  return { ok: true, paymentMethodId: pmId, source: "existing_on_customer" };
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
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const notReusable =
        msg.includes("may not be used again") ||
        msg.includes("previously used without being attached");
      if (notReusable) {
        const fallback = await persistPaymentMethodFromExistingCustomerCards(stripe, customerId);
        if (fallback.ok) {
          return {
            ...fallback,
            warning: "pi_payment_method_not_reusable_used_existing_card",
          };
        }
        return {
          ok: false,
          error: "payment_method_not_reusable",
          hint:
            "Paiement antérieur sans setup_future_usage : impossible de réutiliser cette carte. " +
            "Le membre doit ré-enregistrer sa carte (node scripts/dev-create-member-card-setup.mjs).",
        };
      }
      throw e;
    }
  } else if (attached !== customerId) {
    return { ok: false, error: "payment_method_other_customer" };
  }

  await setCustomerDefaultPaymentMethod(stripe, customerId, paymentMethodId);

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

async function backfillOneInvoice(stripe, inv, customerId, stats) {
  if (!customerId) {
    stats.skipped_no_billing++;
    console.log(`[skip] ${inv.userId ?? "(direct)"} — pas de billing_customers Stripe`);
    return;
  }

  if (!opts.force && stripe) {
    try {
      const cardState = await customerHasCard(stripe, customerId);
      if (!cardState.ok) {
        stats.failed++;
        console.log(`[fail] ${inv.userId ?? customerId} — ${cardState.reason}`);
        return;
      }
      if (cardState.hasCard) {
        stats.skipped_has_card++;
        console.log(`[skip] ${inv.userId ?? customerId} — carte déjà présente (${cardState.source})`);
        return;
      }
    } catch (e) {
      stats.failed++;
      console.log(`[fail] ${inv.userId ?? customerId} — ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }

  const label = `cart ${inv.cartId ?? "—"} · PI ${inv.paymentIntentId.slice(0, 20)}…`;
  if (opts.dryRun) {
    stats.updated++;
    console.log(`[dry-run] ${inv.userId ?? customerId} — ${label} → customer ${customerId}`);
    return;
  }

  try {
    const result = await persistPaymentMethod(stripe, customerId, inv.paymentIntentId, false);
      if (result.ok) {
        stats.updated++;
        const warn = result.warning ? ` (${result.warning})` : "";
        console.log(
          `[ok] ${inv.userId ?? customerId} — ${label} → PM ${result.paymentMethodId}${result.source ? ` [${result.source}]` : ""}${warn}`,
        );
      } else {
        stats.failed++;
        console.log(`[fail] ${inv.userId ?? customerId} — ${result.error}`);
        if (result.hint) console.log(`       → ${result.hint}`);
      }
  } catch (e) {
    stats.failed++;
    console.log(`[fail] ${inv.userId ?? customerId} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log("Backfill Stripe — moyen de paiement par défaut");
  console.log("Exécution:", opts.dryRun ? "DRY-RUN" : "réelle");
  console.log("Stripe:", stripeModeLabel(stripeSecret));
  if (opts.envFile) console.log("Env file:", opts.envFile);
  if (!directMode) console.log("Supabase:", supabaseHostLabel(supabaseUrl));
  if (opts.force) console.log("Force: oui (écrase le défaut existant)");
  if (opts.userId) console.log("Filtre user:", opts.userId);

  if (directMode) {
    console.log("Mode: direct (sans Supabase)");
    console.log("PaymentIntent:", opts.paymentIntentId);
    console.log("Customer:", opts.stripeCustomerId);
    const stripe = opts.dryRun ? null : new Stripe(stripeSecret);
    const stats = {
      skipped_no_billing: 0,
      skipped_has_card: 0,
      updated: 0,
      failed: 0,
    };
    await backfillOneInvoice(
      stripe,
      { paymentIntentId: opts.paymentIntentId, cartId: null, userId: null },
      opts.stripeCustomerId,
      stats,
    );
    console.log("\nRésumé:", stats);
    if (!opts.dryRun && stats.updated > 0) {
      console.log("\nÉtape suivante :");
      console.log(
        "  CRON_DEV_BASE_URL=https://app.segnashare.com node scripts/dev-invoke-cron.mjs member-borrow-overdue-accrual",
      );
    }
    return;
  }

  const invoices = await fetchLatestInvoiceByUser();
  console.log(`Membres avec facture commande Stripe: ${invoices.length}`);
  if (invoices.length === 0) {
    console.log("Rien à faire.");
    if (opts.userId && supabaseHostLabel(supabaseUrl).includes("ptkeulrf")) {
      console.log(
        "→ Tu es sur Supabase DEV (ptkeulrf…). Ce membre est en prod (lzdtip…). Copie STRIPE_SECRET_KEY + SUPABASE prod depuis Vercel, ou utilise le mode direct :",
      );
      console.log(
        "  STRIPE_SECRET_KEY=sk_live_… node scripts/backfill-stripe-customer-payment-methods.mjs \\",
      );
      console.log(
        "    --payment-intent=pi_3TZ95wKHxrskIC2R0NW3i5kO --stripe-customer=cus_UYFa2SfJqnMYbD",
      );
    }
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
    await backfillOneInvoice(stripe, inv, billingByUser.get(inv.userId), stats);
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
