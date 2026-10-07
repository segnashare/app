import { NextResponse } from "next/server";

/**
 * Rate limiting applicatif « best effort » : fenêtre glissante en mémoire, par instance serverless.
 * Protège les routes coûteuses ou abusables (énumération de comptes, API partenaires payantes, chat visiteur).
 * Pour une limite globale et fiable, ajouter en plus une règle Vercel WAF ou un store partagé (Upstash).
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

function prune(now: number, windowMs: number) {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

/**
 * @param key identifiant (ip, user id…) — préfixer par le nom de la route.
 * @param limit nombre d'appels autorisés par fenêtre.
 * @param windowMs taille de la fenêtre glissante.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now, windowMs);
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(key, bucket);
    return { ok: false, retryAfterSeconds };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length };
}

/** Réponse 429 standard, ou `null` si la requête passe. */
export function rateLimitResponse(
  request: Request,
  routeKey: string,
  limit: number,
  windowMs: number,
  subject?: string | null,
): NextResponse | null {
  const key = `${routeKey}:${subject?.trim() || getClientIp(request)}`;
  const result = rateLimit(key, limit, windowMs);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "too_many_requests", message: "Trop de requêtes. Réessaie dans un instant." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
