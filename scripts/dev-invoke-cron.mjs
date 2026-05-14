/**
 * Appelle une route GET /api/cron/* en local (ou autre base URL) avec le même Bearer que la prod.
 * Usage : node scripts/dev-invoke-cron.mjs member-lifecycle-reminders
 *         node scripts/dev-invoke-cron.mjs referral-referrer-sms
 *
 * Lit `.env.local` à la racine du projet (SEGNA_CRON_SECRET ou CRON_SECRET).
 * Surcharge : BASE_URL=https://preview... SEGNA_CRON_SECRET=... node ...
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

const name = process.argv[2] || "member-lifecycle-reminders";
const allowed = new Set(["member-lifecycle-reminders", "referral-referrer-sms"]);
if (!allowed.has(name)) {
  console.error(`Usage: node scripts/dev-invoke-cron.mjs <${[...allowed].join("|")}>`);
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

const base = (env.CRON_DEV_BASE_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const url = `${base}/api/cron/${name}`;

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

console.log(res.status, res.statusText);
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
if (!res.ok) process.exit(1);
