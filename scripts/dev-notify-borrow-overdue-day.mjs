/**
 * Dev : mail + SMS borrow_overdue_daily pour un jour calendaire précis
 * (ex. notif du 26 alors qu'on est encore le 25).
 *
 * Prérequis : `npm run dev` + Resend (+ SEGNA_NOTIFY_SMS_ALERTS=1 pour SMS)
 *
 * Usage :
 *   node scripts/dev-notify-borrow-overdue-day.mjs <cart-uuid> 2026-06-26
 *   node scripts/dev-notify-borrow-overdue-day.mjs <cart-uuid> 2026-06-26 --accrue
 *   node scripts/dev-notify-borrow-overdue-day.mjs <cart-uuid> 2026-06-26 --force
 *     (--force accuse le jour s'il manque, reset idempotence, sans plafond SMS)
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
const calendarDate = (process.argv[3] || "").trim();
const accrueIfMissing = process.argv.includes("--accrue") || process.argv.includes("--force");
const force = process.argv.includes("--force");

if (!/^[0-9a-f-]{36}$/i.test(cartId) || !/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) {
  console.error(
    "Usage: node scripts/dev-notify-borrow-overdue-day.mjs <cart-uuid> YYYY-MM-DD [--accrue] [--force]",
  );
  process.exit(1);
}

const fileEnv = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env") };
const env = { ...fileEnv, ...process.env };
const base = (env.CRON_DEV_BASE_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

const url = `${base}/api/dev/notify-borrow-overdue-day`;
const body = JSON.stringify({
  cart_id: cartId,
  calendar_date: calendarDate,
  accrue_if_missing: accrueIfMissing,
  force,
});

console.log(`→ POST ${url}`);
console.log(`  cart: ${cartId}`);
console.log(`  calendar_date: ${calendarDate}`);
if (accrueIfMissing) {
  console.log(
    force && !process.argv.includes("--accrue")
      ? "  accrue_if_missing: true (--force)"
      : "  accrue_if_missing: true",
  );
}
if (force) console.log("  force: true (reset idempotence jour + Stripe PI + notified_at)");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

const text = await res.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = text;
}

console.log(`${res.status} ${res.statusText}`);
console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));

if (!res.ok) {
  console.error("\nAssure-toi que `npm run dev` tourne sur", base);
  process.exit(1);
}
