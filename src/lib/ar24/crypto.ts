import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

function ivFromPrivateKey(privateKey: string): Buffer {
  const hashed = createHash("sha256").update(privateKey, "utf8").digest("hex");
  const double = createHash("sha256").update(hashed, "utf8").digest("hex");
  return Buffer.from(double.slice(0, 16), "utf8");
}

function keyFromPrivateKey(privateKey: string): Buffer {
  return Buffer.from(createHash("sha256").update(privateKey, "utf8").digest("hex"), "utf8");
}

/** Signature header = AES-256-CBC(date, sha256(privateKey)). Voir doc AR24 § Sign your requests. */
export function ar24EncryptDateHeader(date: string, privateKey: string): string {
  const key = keyFromPrivateKey(privateKey);
  const iv = ivFromPrivateKey(privateKey);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(date, "utf8"), cipher.final()]);
  return encrypted.toString("base64");
}

/** Déchiffre le champ JSON `result` (base64) avec sha256(date + privateKey). */
export function ar24DecryptResponse(encryptedBase64: string, date: string, privateKey: string): string {
  const compositeKey = createHash("sha256").update(`${date}${privateKey}`, "utf8").digest("hex");
  const key = Buffer.from(compositeKey, "utf8");
  const iv = ivFromPrivateKey(privateKey);
  const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Vecteur de test officiel AR24 (doc installation). */
export function ar24CryptoSelfTest(): void {
  const date = "2021-05-26 14:00:00";
  const privateKey = "7X9gx9E3Qx4EiUdB63nc";
  const expectedSignature = "bDop0cbjKpkySlpvnNGvBMg7PuYFFgPPqTTS2RAHoY0=";

  const signature = ar24EncryptDateHeader(date, privateKey);
  if (signature !== expectedSignature) {
    throw new Error(`ar24 signature mismatch: got ${signature}`);
  }

  const encryptedResponse = "WwBOU6s8DaMWmYdctBJwfuoujFgVygBUjhsbdf8eWqQ=";
  const decrypted = ar24DecryptResponse(encryptedResponse, date, privateKey);
  if (!decrypted.includes("SUCCESS")) {
    throw new Error(`ar24 decrypt mismatch: got ${decrypted}`);
  }
}
