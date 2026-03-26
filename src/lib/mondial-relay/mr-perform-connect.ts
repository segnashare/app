import type { BuildMondialRelayShipmentFormInput } from "@/lib/mondial-relay/build-item-shipment";
import { buildMondialRelayShipmentForItem } from "@/lib/mondial-relay/build-item-shipment";
import type { MondialRelayConnectEnv } from "@/lib/mondial-relay/config";
import { createMondialRelayShipmentXml, type MrCreateShipmentResult } from "@/lib/mondial-relay/shipment-xml";

/**
 * Construction XML + appel HTTP Connect (une tentative, un point relais).
 */
export async function performMrConnectShipment(
  config: MondialRelayConnectEnv,
  buildInput: BuildMondialRelayShipmentFormInput,
): Promise<MrCreateShipmentResult> {
  const shipment = buildMondialRelayShipmentForItem(buildInput);
  return createMondialRelayShipmentXml(config, shipment);
}
