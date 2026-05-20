import { withMrNormalizedMobile } from "@/lib/mondial-relay/mr-person-phone";
import type { MrPerson, MrShipmentInput } from "@/lib/mondial-relay/shipment-xml";

export type RelayDeliveryProduct = "24R" | "24L" | "LCC" | "XOH";

export type BuildMondialRelayShipmentFormInput = {
  itemId: string;
  itemTitle: string;
  /** Expéditeur (ex. membre) — complet, plus de repli .env */
  sender: MrPerson;
  /** Destinataire (ex. hub Segna) — fourni par la route (souvent env déploiement) */
  recipient: MrPerson;
  /** Nombre de colis (1–9) */
  parcelCount?: number | null;
  /** Valeur declaree en EUR (entier) */
  contentValueEur?: number | null;
  /** Masse en grammes (obligatoire côté route) */
  weightGr: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  depthCm?: number | null;
  parcelContent?: string | null;
  deliveryInstructions?: string | null;
  /** true = livraison domicile (HOM) */
  deliveryHome?: boolean;
  /** Code point MR (obligatoire si livraison en relais) */
  relayLocation?: string | null;
  collectionMode: "REL" | "CCC";
  /** Utilisé uniquement si !deliveryHome */
  relayDeliveryMode: RelayDeliveryProduct;
  /**
   * Suffixe pour `OrderNo` / `CustomerNo` (caractères alphanum + _ -), ex. "-r2" pour un 2e essai Connect.
   * Évite les collisions côté MR si un essai interfère avec le suivant.
   */
  orderNoSuffix?: string;
};

/**
 * Construit le corps d’expédition MR à partir de paramètres explicites (formulaire + hub en env).
 * Aucune variable de « gabarit colis » dans process.env ici.
 */
export function buildMondialRelayShipmentForItem(
  options: BuildMondialRelayShipmentFormInput,
): MrShipmentInput {
  const useHome = Boolean(options.deliveryHome);
  const relay = options.relayLocation?.trim() ?? "";

  if (!useHome && relay === "") {
    throw new Error("relayLocation requis pour une livraison en point relais");
  }

  const deliveryMode: MrShipmentInput["DeliveryMode"] = useHome
    ? { Mode: "HOM" }
    : { Mode: options.relayDeliveryMode, Location: relay };

  const sanitizedId = options.itemId.replace(/[^a-zA-Z0-9_-]/g, "");
  const suf = (options.orderNoSuffix ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const maxBaseLen = Math.max(1, 28 - suf.length);
  const orderNo =
    (sanitizedId.slice(0, maxBaseLen) + suf).slice(0, 28) || `ORDER-${Date.now()}`;
  const nParcels = Math.min(9, Math.max(1, options.parcelCount ?? 1));
  const contentBase = options.parcelContent?.trim() || options.itemTitle.trim();
  const contentText = (contentBase || "Colis").slice(0, 120);
  const instrParts: string[] = [];
  if (options.deliveryInstructions?.trim()) instrParts.push(options.deliveryInstructions.trim());
  if (options.itemTitle.trim()) instrParts.push(options.itemTitle.trim().slice(0, 80));
  const deliveryInstruction = instrParts.join(" — ").slice(0, 240) || undefined;

  const parcel: MrShipmentInput["Parcels"]["Parcel"] = {
    Content: contentText.slice(0, 80),
    Weight: { Unit: "gr", Value: options.weightGr },
  };
  const l = options.lengthCm;
  const w = options.widthCm;
  const d = options.depthCm;
  if (l != null && l > 0) parcel.Length = { Unit: "cm", Value: l };
  if (w != null && w > 0) parcel.Width = { Unit: "cm", Value: w };
  if (d != null && d > 0) parcel.Depth = { Unit: "cm", Value: d };

  const val = options.contentValueEur;
  const shipmentValue =
    val != null && val > 0 ? { currency: "EUR" as const, amount: String(Math.round(val)) } : undefined;

  return {
    OrderNo: orderNo,
    CustomerNo: orderNo,
    ParcelCount: String(nParcels),
    ...(deliveryInstruction ? { DeliveryInstruction: deliveryInstruction } : {}),
    ...(shipmentValue ? { ShipmentValue: shipmentValue } : {}),
    CollectionMode: { Mode: options.collectionMode },
    DeliveryMode: deliveryMode,
    Sender: withMrNormalizedMobile(options.sender),
    Recipient: withMrNormalizedMobile(options.recipient),
    Parcels: { Parcel: parcel },
  };
}
