/**
 * Crée un Checkout Stripe `mode: setup` pour qu’un membre enregistre (ou ré-enregistre) sa carte.
 * Utile quand un ancien PaymentIntent ne peut plus être rattaché (sans setup_future_usage).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/dev-create-member-card-setup.mjs --stripe-customer=cus_xxx
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/dev-create-member-card-setup.mjs --user-id=<uuid> --env-file=.env.production.local
 *
 * Le membre doit ouvrir l’URL affichée (connecté ou en lui envoyant le lien).
 * Après succès : npm run cron:dev:borrow-overdue (contre prod)
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
  const opts = { envFile: null, userId: null, stripeCustomerId: null, returnUrl: "https://app.segnashare.com/exchange" };
  for (const raw of argv) {
    if (raw.startsWith("--env-file=")) opts.envFile = raw.slice("--env-file=".length).trim();
    else if (raw.startsWith("--user-id=")) opts.userId = raw.slice("--user-id=".length).trim();
    else if (raw.startsWith("--stripe-customer=")) {
      opts.stripeCustomerId = raw.slice("--stripe-customer=".length).trim();
    } else if (raw.startsWith("--return-url=")) opts.returnUrl = raw.slice("--return-url=".length).trim();
    else if (raw === "--help" || raw === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
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

const stripeSecret = (env.STRIPE_SECRET_KEY || "").trim();
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

if (!stripeSecret) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

async function resolveCustomerId() {
  if (opts.stripeCustomerId) return opts.stripeCustomerId;
  if (!opts.userId) {
    console.error("Fournir --stripe-customer=cus_xxx ou --user-id=<uuid> (+ Supabase prod).");
    process.exit(1);
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env pour résoudre billing_customers depuis --user-id.");
    process.exit(1);
  }
  const res = await fetch(
    `${supabaseUrl}/rest/v1/billing_customers?select=provider_customer_id&provider=eq.stripe&user_id=eq.${opts.userId}`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    },
  );
  const rows = await res.json();
  const cid = String(rows?.[0]?.provider_customer_id ?? "").trim();
  if (!cid) {
    console.error("Pas de billing_customers Stripe pour user", opts.userId);
    process.exit(1);
  }
  return cid;
}

const customerId = await resolveCustomerId();
const stripe = new Stripe(stripeSecret);
const returnBase = opts.returnUrl.replace(/\/$/, "");

const session = await stripe.checkout.sessions.create({
  mode: "setup",
  customer: customerId,
  currency: "eur",
  payment_method_types: ["card"],
  success_url: `${returnBase}?card_setup=success`,
  cancel_url: `${returnBase}?card_setup=cancelled`,
  metadata: {
    checkout_kind: "member_card_setup",
    user_id: opts.userId ?? "",
    stripe_customer_id: customerId,
  },
});

console.log("Customer Stripe:", customerId);
if (opts.userId) console.log("User:", opts.userId);
console.log("\nOuvre cette URL (membre connecté sur app.segnashare.com de préférence) :\n");
console.log(session.url ?? "(pas d’URL)");
console.log("\nAprès succès, relance le cron borrow-overdue prod.");
