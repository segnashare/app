import { NextResponse } from "next/server";

import {
  getSendcloudEnv,
  getSendcloudSppCarriersFromEnv,
  isSendcloudCheckoutLivePricingEnabled,
  isSendcloudRelaySearchEnabled,
  isSendcloudServicePointPickerEnabled,
} from "@/lib/sendcloud/config";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import { pickDefaultRelayShippingMethodId } from "@/lib/sendcloud/shipping-options";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const env = getSendcloudEnv();
  if (!env) {
    return NextResponse.json({
      configured: false,
      relay_search_enabled: false,
      missing: ["SENDCLOUD_PUBLIC_KEY", "SENDCLOUD_SECRET_KEY"],
    });
  }

  const integrationId = await resolveSendcloudIntegrationId(env);
  const relayMethodId = await pickDefaultRelayShippingMethodId(env);

  const hub = getSegnaLogisticsHubFromEnv();

  return NextResponse.json({
    configured: true,
    relay_search_enabled: isSendcloudRelaySearchEnabled(),
    service_point_picker_enabled: isSendcloudServicePointPickerEnabled(),
    checkout_live_pricing_enabled: isSendcloudCheckoutLivePricingEnabled(),
    checkout_configuration_id: env.checkoutConfigurationId ? "set" : null,
    logistics_hub_configured: hub != null,
    logistics_hub_postal_code: hub?.postalCode ?? null,
    spp_carriers: getSendcloudSppCarriersFromEnv(),
    integration_id: integrationId,
    relay_shipping_method_id: relayMethodId,
    relay_shipping_option_code: env.relayShippingOptionCode,
    sender_address_id: env.senderAddressId,
    from_country: env.fromCountry,
  });
}
