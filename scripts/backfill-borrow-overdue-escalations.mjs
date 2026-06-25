/**
 * Escalade J+15 (litige retard) pour paniers bloqués sans enum cart_status.disputed.
 * Complète la migration 20260918180000 ou permet un rattrapage manuel.
 *
 * Usage:
 *   node scripts/backfill-borrow-overdue-escalations.mjs
 *   node scripts/backfill-borrow-overdue-escalations.mjs --dry-run
 *   node scripts/backfill-borrow-overdue-escalations.mjs <cart-uuid>
 *
 * Lit `.env.local` : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BORROW_RETURN_TZ = "Europe/Paris";
const MAX_ACCRUAL_DAY = 14;

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

function parisCalendarDateString(nowMs = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BORROW_RETURN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

function borrowOverdueLateDayIndex(nowMs, dueMs) {
  const dueDate = parisCalendarDateString(dueMs);
  const today = parisCalendarDateString(nowMs);
  const dueParts = dueDate.split("-").map(Number);
  const todayParts = today.split("-").map(Number);
  const dueUtc = Date.UTC(dueParts[0], dueParts[1] - 1, dueParts[2]);
  const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const diffDays = Math.round((todayUtc - dueUtc) / 86_400_000);
  return diffDays < 1 ? 0 : diffDays;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const cartIdArg = args.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;

const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findTargets() {
  let overdueQuery = admin
    .from("cart_borrow_overdue")
    .select("cart_id, status")
    .eq("status", "active");

  if (cartIdArg) {
    overdueQuery = overdueQuery.eq("cart_id", cartIdArg);
  }

  const { data: overdueRows, error: oErr } = await overdueQuery;
  if (oErr) throw new Error(oErr.message);
  if (!overdueRows?.length) return [];

  const cartIds = overdueRows.map((r) => r.cart_id);
  const { data: carts, error: cErr } = await admin
    .from("carts")
    .select("id, status, borrow_return_due_at, deleted_at")
    .in("id", cartIds);
  if (cErr) throw new Error(cErr.message);

  const { data: disputes, error: dErr } = await admin
    .from("cart_disputes")
    .select("cart_id")
    .in("cart_id", cartIds)
    .eq("reason", "borrow_return_overdue_escalation")
    .is("deleted_at", null);
  if (dErr) throw new Error(dErr.message);

  const disputedCartIds = new Set((disputes ?? []).map((d) => d.cart_id));
  const nowMs = Date.now();
  const targets = [];

  for (const cart of carts ?? []) {
    if (cart.deleted_at != null) continue;
    if (!["confirmed", "archived"].includes(cart.status ?? "")) continue;
    if (!cart.borrow_return_due_at) continue;
    if (disputedCartIds.has(cart.id)) continue;

    const dueMs = new Date(cart.borrow_return_due_at).getTime();
    const lateDay = borrowOverdueLateDayIndex(nowMs, dueMs);
    if (lateDay <= MAX_ACCRUAL_DAY) continue;

    targets.push({ cartId: cart.id, cartStatus: cart.status, lateDay });
  }

  targets.sort((a, b) => b.lateDay - a.lateDay);
  return targets;
}

const targets = await findTargets();

if (targets.length === 0) {
  console.log("No carts pending borrow overdue escalation.");
  process.exit(0);
}

console.log(`Found ${targets.length} cart(s) to escalate${dryRun ? " (dry-run)" : ""}:`);
for (const t of targets) {
  console.log(`- ${t.cartId} (J+${t.lateDay}, ${t.cartStatus})`);
}

if (dryRun) process.exit(0);

for (const t of targets) {
  const { data, error } = await admin.rpc("accrue_cart_borrow_overdue_day", {
    p_cart_id: t.cartId,
    p_calendar_date: parisCalendarDateString(),
    p_force_notify: false,
  });
  if (error) {
    console.error(`\n[cart ${t.cartId}] ERROR:`, error.message);
    continue;
  }
  console.log(`\n[cart ${t.cartId}]`, JSON.stringify(data, null, 2));
}

console.log("\nDone.");
