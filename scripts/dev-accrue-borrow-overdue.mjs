/**
 * Déclenche `accrue_cart_borrow_overdue_day` (crée cart_borrow_overdue + cart_borrow_overdue_days).
 *
 * Modifier `carts.borrow_return_due_at` à la main ne crée PAS ces lignes : il faut cette RPC.
 * La date doit être l’échéance de RETOUR (pas la date de réception) : en prod elle est fixée à la livraison.
 * (ou le cron `member-lifecycle-reminders`).
 *
 * Usage:
 *   node scripts/dev-accrue-borrow-overdue.mjs <cart-uuid>
 *   node scripts/dev-accrue-borrow-overdue.mjs <cart-uuid> 2026-05-19
 *
 * Lit `.env.local` : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY
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

const cartId = (process.argv[2] || "").trim();
const calendarDate = (process.argv[3] || "").trim() || null;

if (!/^[0-9a-f-]{36}$/i.test(cartId)) {
  console.error("Usage: node scripts/dev-accrue-borrow-overdue.mjs <cart-uuid> [YYYY-MM-DD]");
  process.exit(1);
}

const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
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

async function rpc(fn, args) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} rpc/${fn}: ${typeof body === "object" ? JSON.stringify(body) : body}`);
  }
  return body;
}

console.log("Cart:", cartId);
if (calendarDate) console.log("Calendar date (Paris day):", calendarDate);

const carts = await rest(
  `carts?select=id,status,borrow_return_due_at,deleted_at&id=eq.${cartId}`,
);
const cart = carts?.[0];
if (!cart) {
  console.error("Cart not found.");
  process.exit(1);
}
console.log("\n[cart]", JSON.stringify(cart, null, 2));

const outbound = await rest(
  `shipments?select=status,context,delivered_at&cart_id=eq.${cartId}&context=eq.cart_outbound&deleted_at=is.null&order=created_at.desc&limit=1`,
);
console.log("\n[outbound]", JSON.stringify(outbound?.[0] ?? null, null, 2));

const ret = await rest(
  `shipments?select=status,context&cart_id=eq.${cartId}&context=eq.cart_return&deleted_at=is.null&order=created_at.desc&limit=1`,
);
console.log("\n[return]", JSON.stringify(ret?.[0] ?? null, null, 2));

let overdueBefore = [];
try {
  overdueBefore = await rest(
    `cart_borrow_overdue?select=id,status,opened_on&cart_id=eq.${cartId}`,
  );
} catch (e) {
  console.error(
    "\n⚠ Table cart_borrow_overdue inaccessible — migration 20260821180000 appliquée sur ce projet Supabase ?",
    e.message,
  );
  process.exit(1);
}
console.log("\n[overdue before]", JSON.stringify(overdueBefore, null, 2));

const rpcArgs = { p_cart_id: cartId, p_force_notify: false };
if (calendarDate) rpcArgs.p_calendar_date = calendarDate;

const result = await rpc("accrue_cart_borrow_overdue_day", rpcArgs);
console.log("\n[accrue result]", JSON.stringify(result, null, 2));

const overdueAfter = await rest(
  `cart_borrow_overdue?select=id,status,cart_value_cents&cart_id=eq.${cartId}`,
);
const days = await rest(
  `cart_borrow_overdue_days?select=late_day_index,calendar_date,penalty_cents,charge_status&cart_id=eq.${cartId}&order=late_day_index.asc`,
);
console.log("\n[overdue after]", JSON.stringify(overdueAfter, null, 2));
console.log("[days]", JSON.stringify(days, null, 2));

if (result?.skipped === "not_overdue") {
  console.log(
    "\n→ Pas encore en retard côté Paris (late_day < 1). La date limite est le jour civil : le retard commence le lendemain à minuit Paris.",
  );
}
if (result?.skipped === "cart_status") {
  console.log("\n→ Statut panier invalide : doit être confirmed ou archived.");
}
if (result?.skipped === "return_commitment_met") {
  console.log("\n→ Retour déjà engagé (dropped_out, in_transit, etc.) : pas de pénalité.");
}
if (result?.applied === true) {
  console.log("\n✓ Jour de retard enregistré. Recharge la page emprunt dans l’app.");
}
