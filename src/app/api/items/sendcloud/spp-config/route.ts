import { NextResponse } from "next/server";

import { getSendcloudEnv, isSendcloudServicePointPickerEnabled } from "@/lib/sendcloud/config";
import { resolveSendcloudSppCarriers } from "@/lib/sendcloud/integrations";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/** Config publique du widget Service Point Picker (clé d’intégration Sendcloud). */
export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);
  if (userError || !user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const env = getSendcloudEnv();
  if (!env || !isSendcloudServicePointPickerEnabled()) {
    return NextResponse.json({ enabled: false }, { status: 200 });
  }

  const carriers = await resolveSendcloudSppCarriers(env);

  return NextResponse.json({
    enabled: true,
    api_key: env.publicKey,
    country: "FR",
    language: "fr-fr",
    carriers,
    script_url: "https://embed.sendcloud.sc/spp/1.0.0/api.min.js",
  });
}
