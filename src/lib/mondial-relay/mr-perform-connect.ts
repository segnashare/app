import type {
  BuildMondialRelayShipmentFormInput,
  RelayDeliveryProduct,
} from "@/lib/mondial-relay/build-item-shipment";
import { buildMondialRelayShipmentForItem } from "@/lib/mondial-relay/build-item-shipment";
import type { MondialRelayConnectEnv } from "@/lib/mondial-relay/config";
import { mondialRelayRelayLocationVariants } from "@/lib/mondial-relay/relay-location-variants";
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

const RELAY_TRI_FALLBACK: RelayDeliveryProduct[] = ["24R", "24L", "LCC", "XOH"];

export type MrRelayAttemptResult = MrCreateShipmentResult & {
  usedRelayProduct?: RelayDeliveryProduct;
  usedRelayLocation?: string;
  usedCollectionMode?: "REL" | "CCC";
  relayAttempts?: Array<{
    product: RelayDeliveryProduct;
    message: string;
    relayLocation: string;
    collectionMode: "REL" | "CCC";
  }>;
};

/**
 * Point relais : enchaîne plusieurs produits MR si le « plan de tri » refuse le premier.
 */
export async function performMrConnectRelayWithProductFallback(
  config: MondialRelayConnectEnv,
  buildInput: BuildMondialRelayShipmentFormInput,
): Promise<MrRelayAttemptResult> {
  if (buildInput.deliveryHome) {
    const r = await performMrConnectShipment(config, buildInput);
    return r.ok ? { ...r, usedRelayProduct: undefined } : r;
  }

  const baseSuffix = (buildInput.orderNoSuffix ?? "").trim();
  const primary = buildInput.relayDeliveryMode;
  const tryOrder: RelayDeliveryProduct[] = [
    primary,
    ...RELAY_TRI_FALLBACK.filter((p) => p !== primary),
  ];

  const relayLocs = mondialRelayRelayLocationVariants(buildInput.relayLocation);
  const collectionPass: ("REL" | "CCC")[] =
    buildInput.collectionMode === "CCC" ? ["CCC", "REL"] : ["REL", "CCC"];
  const collectionModes = [...new Set(collectionPass)];

  const attempts: Array<{
    product: RelayDeliveryProduct;
    message: string;
    relayLocation: string;
    collectionMode: "REL" | "CCC";
  }> = [];
  let lastMessage = "Echec Mondial Relay";
  let attemptIdx = 0;

  for (const collectionMode of collectionModes) {
    for (const relayLocation of relayLocs) {
      for (const relayDeliveryMode of tryOrder) {
        const orderNoSuffix = attemptIdx === 0 ? baseSuffix : `${baseSuffix}x${attemptIdx}`;
        attemptIdx += 1;
        const r = await performMrConnectShipment(config, {
          ...buildInput,
          collectionMode,
          relayLocation,
          relayDeliveryMode,
          orderNoSuffix,
        });
        if (r.ok) {
          return {
            ...r,
            usedRelayProduct: relayDeliveryMode,
            usedRelayLocation: relayLocation,
            usedCollectionMode: collectionMode,
            relayAttempts: attempts.length > 0 ? attempts : undefined,
          };
        }
        lastMessage = r.message;
        attempts.push({
          product: relayDeliveryMode,
          message: r.message,
          relayLocation,
          collectionMode,
        });
      }
    }
  }

  const triedProducts = tryOrder.join(" → ");
  const triedLocs = relayLocs.join(" | ");
  const triedColl = collectionModes.join(" / ");
  return {
    ok: false,
    message: [
      `Échec après essais MR (produits : ${triedProducts} ; codes relais : ${triedLocs} ; collecte : ${triedColl}).`,
      `Dernier message : ${lastMessage}`,
    ].join(" "),
    relayAttempts: attempts,
  };
}
