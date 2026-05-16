import { NextResponse } from "next/server";

import { getShippingEnvDiagnostics } from "@/lib/shipping/server-env-diagnostics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET — diagnostic complet des variables transport (membre connecté).
 * Réponse : noms des vars manquantes + longueurs (jamais les secrets).
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const diagnostics = getShippingEnvDiagnostics();

  return NextResponse.json({
    ok: true,
    summary: {
      mondial_relay_soap_ready: diagnostics.mondial_relay_soap.configured,
      mondial_relay_connect_ready: diagnostics.mondial_relay_connect.configured,
      mondial_relay_hub_ready: diagnostics.mondial_relay_hub.configured,
      uber_direct_ready: diagnostics.uber_direct.configured,
    },
    diagnostics,
  });
}
