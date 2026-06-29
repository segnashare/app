/**
 * Appelle une route GET /api/cron/* en local, preview ou prod avec le Bearer cron.
 *
 * Usage :
 *   node scripts/dev-invoke-cron.mjs member-borrow-return-reminders
 *   node scripts/dev-invoke-cron.mjs member-borrow-overdue-accrual
 *   node scripts/dev-invoke-cron.mjs member-onboarding-reminders
 *   node scripts/dev-invoke-cron.mjs member-abandoned-cart-reminders
 *   node scripts/dev-invoke-cron.mjs all
 *   node scripts/dev-invoke-cron.mjs all --preview
 *
 * Legacy (agrégats tests manuels) :
 *   member-lifecycle-reminders | member-engagement-reminders
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

const CRON_ROUTES = [
  "member-borrow-overdue-accrual",
  "member-borrow-formal-notice",
  "member-borrow-non-restitution-invoice",
  "member-onboarding-reminders",
  "member-abandoned-cart-reminders",
  "member-borrow-return-reminders",
  "referral-referrer-sms",
  "economy-demand-metrics",
  "economy-exchange-recalibration",
];

const LEGACY_ROUTES = ["member-lifecycle-reminders", "member-engagement-reminders"];

const name = process.argv[2] || "member-borrow-return-reminders";
const usePreview = process.argv.includes("--preview");
const allowed = new Set([...CRON_ROUTES, ...LEGACY_ROUTES, "all"]);
if (!allowed.has(name)) {
  console.error(
    `Usage: node scripts/dev-invoke-cron.mjs <${[...allowed].join("|")}> [--preview]`,
  );
  process.exit(1);
}

const fileEnv = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env") };
const env = { ...fileEnv, ...process.env };
const secret = (env.SEGNA_CRON_SECRET || env.CRON_SECRET || "").trim();
if (!secret) {
  console.error(
    "Missing SEGNA_CRON_SECRET (or CRON_SECRET) in .env.local / environment.",
  );
  process.exit(1);
}

const base = (
  (usePreview ? env.CRON_PREVIEW_BASE_URL : null) ||
  env.CRON_DEV_BASE_URL ||
  env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

async function invokeCron(routeName) {
  const url = `${base}/api/cron/${routeName}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log(`\n→ ${routeName}`);
  console.log(`  ${url}`);
  console.log(`  ${res.status} ${res.statusText}`);
  console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return res.ok;
}

console.log(`Base: ${base}${usePreview ? " (preview)" : ""}`);

const routes =
  name === "all"
    ? [...CRON_ROUTES]
    : [name];

let failed = false;
for (const route of routes) {
  const ok = await invokeCron(route);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
