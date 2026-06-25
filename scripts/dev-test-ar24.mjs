/**
 * Test intégration AR24 :
 * 1. Vecteur crypto doc officielle
 * 2. GET /user (token + clé privée + id_user)
 *
 * Usage :
 *   node scripts/dev-test-ar24.mjs
 *   node scripts/dev-test-ar24.mjs --crypto-only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cryptoOnly = process.argv.includes("--crypto-only");

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

function ivFromPrivateKey(privateKey) {
  const hashed = createHash("sha256").update(privateKey, "utf8").digest("hex");
  const double = createHash("sha256").update(hashed, "utf8").digest("hex");
  return Buffer.from(double.slice(0, 16), "utf8");
}

function keyFromPrivateKey(privateKey) {
  return Buffer.from(createHash("sha256").update(privateKey, "utf8").digest("hex"), "utf8");
}

function ar24EncryptDateHeader(date, privateKey) {
  const key = keyFromPrivateKey(privateKey);
  const iv = ivFromPrivateKey(privateKey);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  return Buffer.concat([cipher.update(date, "utf8"), cipher.final()]).toString("base64");
}

function ar24DecryptResponse(encryptedBase64, date, privateKey) {
  const compositeKey = createHash("sha256").update(`${date}${privateKey}`, "utf8").digest("hex");
  const key = Buffer.from(compositeKey, "utf8");
  const iv = ivFromPrivateKey(privateKey);
  const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const date = "2021-05-26 14:00:00";
const privateKey = "7X9gx9E3Qx4EiUdB63nc";
const signature = ar24EncryptDateHeader(date, privateKey);
const decrypted = ar24DecryptResponse(
  "WwBOU6s8DaMWmYdctBJwfuoujFgVygBUjhsbdf8eWqQ=",
  date,
  privateKey,
);

console.log("=== AR24 crypto (doc officielle) ===");
console.log("signature:", signature);
console.log("expected :", "bDop0cbjKpkySlpvnNGvBMg7PuYFFgPPqTTS2RAHoY0=");
console.log("decrypted:", decrypted);
console.log("expected : contains SUCCESS");

if (signature !== "bDop0cbjKpkySlpvnNGvBMg7PuYFFgPPqTTS2RAHoY0=") {
  console.error("✗ signature mismatch");
  process.exit(1);
}
if (!decrypted.includes("SUCCESS")) {
  console.error("✗ decrypt mismatch");
  process.exit(1);
}
console.log("✓ crypto OK\n");

if (cryptoOnly) process.exit(0);

const env = { ...loadDotEnvFile(".env.local"), ...loadDotEnvFile(".env"), ...process.env };
const base = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

const res = await fetch(`${base}/api/dev/test-ar24`);
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log("=== AR24 ping (GET /user via app) ===");
console.log(`${res.status} ${res.statusText}`);
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
if (!res.ok || body.ok === false) process.exit(1);
