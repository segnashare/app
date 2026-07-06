import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudServicePointsFetch } from "@/lib/sendcloud/client";
import { parseSendcloudRelayPointRef, relayPointCodeMatchKey, relayPointCodesMatch } from "@/lib/sendcloud/relay-point-ref";

export type SendcloudServicePointHit = {
  id: number;
  code: string;
  displayCode: string;
  label: string;
  postalCode: string;
  city: string;
  street: string;
  carrier: string;
};

type RawServicePoint = {
  id?: number;
  code?: string;
  name?: string;
  street?: string;
  house_number?: string;
  postal_code?: string;
  city?: string;
  carrier?: string;
  is_active?: boolean;
};

function formatRelayDisplayCode(code: string, country: string): string {
  const c = code.trim();
  if (!c) return "";
  if (c.includes("-")) return c.toUpperCase();
  const cc = country.trim().toUpperCase() || "FR";
  const upper = c.toUpperCase();
  if (upper.startsWith(cc)) {
    const rest = upper.slice(cc.length);
    if (/^\d+$/.test(rest)) {
      return `${cc}-${rest.padStart(6, "0")}`;
    }
  }
  return `${cc}-${c}`;
}

function formatLabel(sp: RawServicePoint): string {
  const name = (sp.name ?? "Point relais").trim();
  const street = [sp.street, sp.house_number].filter(Boolean).join(" ").trim();
  const cityLine = [sp.postal_code, sp.city].filter(Boolean).join(" ").trim();
  const parts = [name, street, cityLine].filter((x) => x.length > 0);
  return parts.join(" — ").slice(0, 200);
}

export async function searchSendcloudServicePoints(
  env: SendcloudEnv,
  params: { country: string; postalCode: string; carrier?: string },
): Promise<{ points: SendcloudServicePointHit[]; error?: string }> {
  const country = params.country.trim().toUpperCase() || "FR";
  const postalCode = params.postalCode.replace(/\D/g, "").slice(0, 5);
  if (postalCode.length !== 5) {
    return { points: [], error: "Code postal invalide" };
  }

  const carrier = (params.carrier ?? "mondial_relay").trim();
  const qs = new URLSearchParams({
    country,
    postal_code: postalCode,
    carrier,
  });

  const res = await sendcloudServicePointsFetch<RawServicePoint[]>(
    env,
    `/service-points?${qs.toString()}`,
    { method: "GET" },
  );

  if (!res.ok) {
    return { points: [], error: res.error };
  }

  const raw = Array.isArray(res.data) ? res.data : [];
  const points: SendcloudServicePointHit[] = [];
  for (const sp of raw) {
    if (sp.is_active === false) continue;
    const id = typeof sp.id === "number" ? sp.id : null;
    const code = typeof sp.code === "string" ? sp.code.trim() : "";
    if (id == null || !code) continue;
    points.push({
      id,
      code,
      displayCode: formatRelayDisplayCode(code, country),
      label: formatLabel(sp),
      postalCode: String(sp.postal_code ?? postalCode),
      city: String(sp.city ?? "").trim(),
      street: [sp.street, sp.house_number].filter(Boolean).join(" ").trim(),
      carrier: String(sp.carrier ?? carrier),
    });
  }

  return { points };
}

export type ResolvedSendcloudServicePoint = {
  id: number;
  displayCode: string;
  carrier: string | null;
  postNumber: string | null;
  postalCode: string;
  city: string;
  street: string;
  label: string;
};

/** Résout un code panier (FR-…, sc:123, id numérique) vers l’id Sendcloud. */
export async function resolveSendcloudServicePointId(
  env: SendcloudEnv,
  params: { relayCode: string; country: string; postalCode: string },
): Promise<ResolvedSendcloudServicePoint | { error: string }> {
  const raw = params.relayCode.trim();
  if (!raw) return { error: "Code relais manquant" };

  const country = params.country.trim().toUpperCase() || "FR";
  const postalCode = params.postalCode.replace(/\D/g, "").slice(0, 5);
  const parsedRef = parseSendcloudRelayPointRef(raw);
  const numericId =
    parsedRef?.servicePointId ??
    (/^sc:(\d+)$/i.exec(raw)?.[1] ? parseInt(/^sc:(\d+)$/i.exec(raw)![1]!, 10) : null) ??
    (/^\d+$/.test(raw) ? parseInt(raw, 10) : null);

  const { points, error } = await searchSendcloudServicePoints(env, {
    country,
    postalCode: postalCode.length === 5 ? postalCode : params.postalCode,
    carrier: "mondial_relay",
  });

  if (numericId != null && Number.isFinite(numericId)) {
    const hit = points.find((p) => p.id === numericId);
    if (hit) {
      return {
        id: hit.id,
        displayCode: hit.displayCode,
        carrier: hit.carrier ?? parsedRef?.carrier ?? null,
        postNumber: parsedRef?.postNumber ?? null,
        postalCode: hit.postalCode,
        city: hit.city,
        street: hit.street,
        label: hit.label,
      };
    }
  }

  const matchKey = relayPointCodeMatchKey(raw);
  if (error && points.length === 0) {
    return { error };
  }

  const hit =
    points.find((p) => relayPointCodesMatch(p.code, raw)) ||
    points.find((p) => relayPointCodesMatch(p.displayCode, raw)) ||
    points.find((p) => relayPointCodeMatchKey(p.code) === matchKey) ||
    points.find((p) => relayPointCodeMatchKey(p.displayCode) === matchKey);

  if (!hit) {
    if (numericId != null && Number.isFinite(numericId)) {
      return {
        id: numericId,
        displayCode: raw,
        carrier: parsedRef?.carrier ?? null,
        postNumber: parsedRef?.postNumber ?? null,
        postalCode: postalCode.length === 5 ? postalCode : "",
        city: "",
        street: "",
        label: raw,
      };
    }
    return {
      error: `Point relais « ${raw} » introuvable via Sendcloud pour ${params.postalCode}.`,
    };
  }

  return {
    id: hit.id,
    displayCode: hit.displayCode,
    carrier: hit.carrier,
    postNumber: parsedRef?.postNumber ?? null,
    postalCode: hit.postalCode,
    city: hit.city,
    street: hit.street,
    label: hit.label,
  };
}
