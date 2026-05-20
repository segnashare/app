import { NextResponse } from "next/server";

import { listCheckoutReturnHubRelays } from "@/lib/sendcloud/resolve-checkout-return-relay-hub";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Points relais hub retour (usage interne / admin). Le checkout membre n’expose plus ce choix.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const carrier = typeof o.carrier === "string" ? o.carrier.trim() : "mondial_relay";

  const listed = await listCheckoutReturnHubRelays({ carrier });
  if (!listed.ok) {
    return NextResponse.json(
      { points: [], error: listed.error, provider: "sendcloud" },
      { status: listed.status },
    );
  }

  return NextResponse.json({
    points: listed.points,
    provider: "sendcloud",
    hub: { postalCode: listed.hubPostal },
    return_only: true,
  });
}
