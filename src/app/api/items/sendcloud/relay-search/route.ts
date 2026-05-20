import { NextResponse } from "next/server";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { searchSendcloudServicePoints } from "@/lib/sendcloud/service-points";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const env = getSendcloudEnv();
  if (!env) {
    return NextResponse.json(
      {
        error: "Sendcloud non configuré (SENDCLOUD_PUBLIC_KEY / SENDCLOUD_SECRET_KEY).",
        points: [],
      },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const postalCode = typeof o.postal_code === "string" ? o.postal_code.trim() : "";
  const country =
    (typeof o.country === "string" ? o.country.trim().toUpperCase() : "") || "FR";
  const carrier = typeof o.carrier === "string" ? o.carrier.trim() : "mondial_relay";

  if (postalCode.replace(/\D/g, "").length < 5) {
    return NextResponse.json({ error: "postal_code requis (5 chiffres)" }, { status: 400 });
  }

  const hub = getSegnaRecipientFromEnv();
  const memberPc = postalCode.replace(/\D/g, "").slice(0, 5);
  const hubPc = hub?.PostCode?.replace(/\D/g, "").slice(0, 5) ?? "";
  const searchPostcodes = hubPc && hubPc !== memberPc ? [memberPc, hubPc] : [memberPc];

  const seen = new Set<number>();
  const points: Array<{
    code: string;
    label: string;
    postalCode: string;
    city?: string;
    sendcloudServicePointId: number;
    sendcloudCode: string;
  }> = [];

  for (const pc of searchPostcodes) {
    const { points: batch, error } = await searchSendcloudServicePoints(env, {
      country,
      postalCode: pc,
      carrier,
    });
    if (error && batch.length === 0 && points.length === 0) {
      return NextResponse.json({ points: [], error, provider: "sendcloud" }, { status: 502 });
    }
    for (const p of batch) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      points.push({
        code: p.displayCode,
        label: p.label,
        postalCode: p.postalCode,
        city: p.city || undefined,
        sendcloudServicePointId: p.id,
        sendcloudCode: p.code,
      });
    }
  }

  if (points.length === 0) {
    const hubHint = hub?.PostCode ? ` (hub Segna : ${hub.PostCode})` : "";
    return NextResponse.json({
      points: [],
      provider: "sendcloud",
      search_postcodes: searchPostcodes,
      hint: `Aucun point relais Mondial Relay via Sendcloud pour ${searchPostcodes.join(", ")}${hubHint}.`,
    });
  }

  return NextResponse.json({
    points,
    provider: "sendcloud",
    search_postcodes: searchPostcodes,
    destination_postcode: hub?.PostCode ?? null,
  });
}
