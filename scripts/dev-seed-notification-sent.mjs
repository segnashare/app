/**
 * Enregistre tous les types `notification_sent` dans PostHog (local, sans SMS Twilio).
 *
 * Prérequis : `npm run dev` + `NEXT_PUBLIC_POSTHOG_KEY` dans .env.local
 *
 * Usage :
 *   npm run analytics:seed-notification-sent
 *   npm run analytics:seed-notification-sent -- <user-uuid>
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

const userIdArg = process.argv[2]?.trim() || "";
const fileEnv = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env") };
const env = { ...fileEnv, ...process.env };

const base = (env.CRON_DEV_BASE_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const posthogKey = (env.NEXT_PUBLIC_POSTHOG_KEY || "").trim();

if (!posthogKey) {
  console.error("Missing NEXT_PUBLIC_POSTHOG_KEY in .env.local");
  process.exit(1);
}

const url = `${base}/api/dev/seed-notification-sent`;
const body = userIdArg ? JSON.stringify({ user_id: userIdArg }) : "{}";

console.log(`→ POST ${url}`);
if (userIdArg) console.log(`  user_id: ${userIdArg}`);

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

console.log("\nPostHog → Activity : filtre event `notification_sent` (délai ~30s).");
