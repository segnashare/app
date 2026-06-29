/**
 * Dev : facture Stripe indemnité non-restitution (PR5).
 *
 * Usage :
 *   node scripts/dev-send-borrow-non-restitution-invoice.mjs <cart_id>
 *   node scripts/dev-send-borrow-non-restitution-invoice.mjs <cart_id> --force
 *     (--force efface une facture dry-run existante avant réémission)
 *   node scripts/dev-send-borrow-non-restitution-invoice.mjs <cart_id> --force --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const cartId = process.argv[2]?.trim();
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run") || process.env.SEGNA_BORROW_NON_RESTITUTION_DRY_RUN === "1";
const resendStripeEmail = process.argv.includes("--resend-stripe-email");

if (!cartId || !/^[0-9a-f-]{36}$/i.test(cartId)) {
  console.error(
    "Usage: node scripts/dev-send-borrow-non-restitution-invoice.mjs <cart_id> [--force] [--dry-run]",
  );
  process.exit(1);
}

const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const base = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const url = `${base}/api/dev/send-borrow-non-restitution-invoice`;

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cart_id: cartId, force, dry_run: dryRun, resend_stripe_email: resendStripeEmail }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(`${res.status} ${res.statusText}`);
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
if (!res.ok) process.exit(1);
