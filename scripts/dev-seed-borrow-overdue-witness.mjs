/**
 * Affiche / vérifie l'état témoin « borrow overdue escaladé » pour le dev.
 * Source : scripts/fixtures/borrow-overdue-witness-prod-snapshot.json (export prod anonymisé).
 *
 * Usage:
 *   node scripts/dev-seed-borrow-overdue-witness.mjs
 *   node scripts/dev-seed-borrow-overdue-witness.mjs --dry-run
 *   node scripts/dev-seed-borrow-overdue-witness.mjs --verify
 *
 * Lit `.env.local` : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * ⚠️ Ne pas pointer vers PROD pour --verify (lecture seule mais évite les accidents).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/borrow-overdue-witness-prod-snapshot.json");

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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verify = args.includes("--verify");

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const cartId = fixture.cart.id;

console.log("=== Borrow overdue witness (prod snapshot) ===\n");
console.log("Fixture:", FIXTURE_PATH);
console.log("Cart ID:", cartId);
console.log("Snapshot:", fixture._meta.snapshot_at);
console.log("Late day at snapshot:", fixture.metrics_at_snapshot.late_day_today);
console.log("Status:", fixture.cart.status, "| overdue:", fixture.cart_borrow_overdue.status);
console.log("Penalties:", fixture.metrics_at_snapshot.total_penalty_cents, "cts over", fixture.metrics_at_snapshot.penalty_day_count, "days");
console.log("Cart value:", fixture.cart_borrow_overdue.cart_value_cents, "cts");
console.log("Dispute:", fixture.cart_dispute?.reason, fixture.cart_dispute?.status);
console.log("Return shipment:", fixture.shipments.return.status);
console.log("\nAnonymized member:", fixture.cart.member_email_anonymized);

console.log("\n--- Dev setup checklist ---");
console.log("1. Utiliser un panier dev existant OU cloner la structure (confirmed → disputed après escalade).");
console.log("2. borrow_return_due_at:", fixture.cart.borrow_return_due_at);
console.log("3. Insérer cart_borrow_overdue + 14 cart_borrow_overdue_days (voir fixture.penalty_days).");
console.log("4. Escalade : accrue_cart_borrow_overdue_day avec late_day > 14 (après enum disputed).");
console.log("5. Pour rejouer les phases futures, voir docs/plans/borrow-non-return-recovery-workflow.md");

if (!verify) {
  if (dryRun) {
    console.log("\n(dry-run — pas de requête Supabase)");
    process.exit(0);
  }
  console.log("\nAjoute --verify pour comparer l'état d'un projet Supabase (dev) au fixture.");
  process.exit(0);
}

const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

if (!url || !key) {
  console.error("\nMissing Supabase env for --verify");
  process.exit(1);
}

if (/prod|production/i.test(url) || /prod/i.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) {
  console.error("\nRefusing --verify against what looks like PROD URL:", url);
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(tableQuery) {
  const res = await fetch(`${url}/rest/v1/${tableQuery}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}

try {
  const carts = await rest(`carts?select=id,status,borrow_return_due_at&id=eq.${cartId}`);
  const overdue = await rest(`cart_borrow_overdue?select=id,status,resolution,cart_value_cents&cart_id=eq.${cartId}`);
  const days = await rest(
    `cart_borrow_overdue_days?select=late_day_index,charge_status&cart_id=eq.${cartId}&order=late_day_index.asc`,
  );
  const disputes = await rest(
    `cart_disputes?select=id,reason,status&cart_id=eq.${cartId}&deleted_at=is.null`,
  );

  console.log("\n--- Dev DB state ---");
  console.log("cart:", carts[0] ?? "NOT FOUND");
  console.log("overdue:", overdue[0] ?? "NOT FOUND");
  console.log("days:", days.length, "rows");
  console.log("disputes:", disputes.length ? disputes[0] : "NONE");

  const cart = carts[0];
  if (!cart) {
    console.log("\nCart absent en dev — utiliser un autre cart_id ou importer manuellement.");
    process.exit(1);
  }

  const ok =
    cart.status === fixture.cart.status &&
    overdue[0]?.status === fixture.cart_borrow_overdue.status &&
    days.length === fixture.penalty_days.length;

  console.log(ok ? "\n✓ État proche du témoin prod" : "\n⚠ Écart avec le fixture — voir checklist ci-dessus");
} catch (e) {
  console.error("\nVerify failed:", e.message);
  process.exit(1);
}
