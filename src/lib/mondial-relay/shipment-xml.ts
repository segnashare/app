import { Builder } from "xml2js";

import type { MondialRelayConnectEnv } from "@/lib/mondial-relay/config";
import { resolveMondialRelayShipmentUrl } from "@/lib/mondial-relay/connect-client";

/** Aligné sur le format @frontboI/mondial-relay (API Connect, corps XML). */
export type MrPerson = {
  Firstname: string;
  Lastname: string;
  Streetname: string;
  HouseNo: string;
  CountryCode: string;
  PostCode: string;
  City: string;
  PhoneNo: string;
  MobileNo: string;
  Email: string;
  Title?: "Mr" | "Mme";
};

export type MrParcelLine = {
  Content: string;
  Weight: { Unit: "gr"; Value: number };
  Length?: { Unit: "cm"; Value: number };
  Width?: { Unit: "cm"; Value: number };
  Depth?: { Unit: "cm"; Value: number };
};

export type MrShipmentInput = {
  OrderNo: string;
  CustomerNo: string;
  ParcelCount: string;
  DeliveryInstruction?: string;
  ShipmentValue?: { currency: "EUR"; amount: string };
  CollectionMode: { Mode: "CCC" | "REL" };
  DeliveryMode: { Mode: "LCC" | "HOM" | "24R" | "24L" | "XOH"; Location?: string };
  Sender: MrPerson;
  Recipient: MrPerson;
  Parcels: {
    Parcel: MrParcelLine;
  };
};

function generateXML(data: object): string {
  const builder = new Builder({ headless: true });
  return builder.buildObject(data);
}

function shipmentPayloadToXml(
  context: {
    Login: string;
    Password: string;
    CustomerId: string;
    Culture?: string;
    VersionAPI?: string;
  },
  shipment: MrShipmentInput,
  outputOptions?: { OutputFormat?: string; OutputType?: string },
): string {
  const data = {
    ShipmentCreationRequest: {
      $: {
        xmlns: "http://www.example.org/Request",
        "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      },
      Context: {
        Login: context.Login,
        Password: context.Password,
        CustomerId: context.CustomerId,
        Culture: context.Culture ?? "fr-FR",
        VersionAPI: context.VersionAPI ?? "1.0",
      },
      OutputOptions: {
        OutputFormat: outputOptions?.OutputFormat ?? "A4",
        OutputType: outputOptions?.OutputType ?? "PdfUrl",
      },
      ShipmentsList: {
        Shipment: {
          OrderNo: shipment.OrderNo,
          CustomerNo: shipment.CustomerNo,
          ParcelCount: shipment.ParcelCount,
          ...(shipment.DeliveryInstruction != null && shipment.DeliveryInstruction !== ""
            ? { DeliveryInstruction: shipment.DeliveryInstruction }
            : {}),
          ...(shipment.ShipmentValue != null
            ? {
                ShipmentValue: {
                  $: {
                    currency: shipment.ShipmentValue.currency,
                    amount: shipment.ShipmentValue.amount,
                  },
                },
              }
            : {}),
          CollectionMode: {
            $: { ...shipment.CollectionMode },
          },
          DeliveryMode: {
            $: {
              ...shipment.DeliveryMode,
            },
          },
          Parcels: {
            Parcel: {
              Content: shipment.Parcels.Parcel.Content,
              Weight: {
                $: {
                  Unit: shipment.Parcels.Parcel.Weight.Unit,
                  Value: shipment.Parcels.Parcel.Weight.Value,
                },
              },
              ...(shipment.Parcels.Parcel.Length != null
                ? { Length: { $: { ...shipment.Parcels.Parcel.Length } } }
                : {}),
              ...(shipment.Parcels.Parcel.Width != null
                ? { Width: { $: { ...shipment.Parcels.Parcel.Width } } }
                : {}),
              ...(shipment.Parcels.Parcel.Depth != null
                ? { Depth: { $: { ...shipment.Parcels.Parcel.Depth } } }
                : {}),
            },
          },
          Sender: {
            Address: { ...shipment.Sender },
          },
          Recipient: {
            Address: { ...shipment.Recipient },
          },
        },
      },
    },
  };

  return generateXML(data);
}

export type MrCreateShipmentResult =
  | { ok: true; sendingNumber: string; etiquetteLink: string; raw: unknown }
  | { ok: false; message: string; raw?: unknown };

function extractResult(data: unknown): MrCreateShipmentResult {
  if (data == null || typeof data !== "object") {
    return { ok: false, message: "Reponse MR vide ou invalide" };
  }
  const d = data as Record<string, unknown>;
  const statusList = d.statusListField as unknown;
  if (Array.isArray(statusList)) {
    const err = statusList.find(
      (e) =>
        e &&
        typeof e === "object" &&
        String((e as Record<string, unknown>).levelField ?? "").toLowerCase().includes("error"),
    );
    if (err && typeof err === "object") {
      const msg = (err as Record<string, unknown>).messageField;
      return { ok: false, message: typeof msg === "string" ? msg : "Erreur MR (statusListField)", raw: data };
    }
  }
  const list = d.shipmentsListField as unknown;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== "object") {
    return { ok: false, message: "Reponse MR sans shipmentsListField", raw: data };
  }
  const ship = first as Record<string, unknown>;
  const sendingNumber = String(ship.shipmentNumberField ?? "").trim();
  const labelList = ship.labelListField as Record<string, unknown> | undefined;
  const labelField = labelList?.labelField as Record<string, unknown> | undefined;
  const outputField = labelField?.outputField;
  const etiquetteLink = typeof outputField === "string" ? outputField.trim() : "";
  if (!etiquetteLink || !sendingNumber) {
    return { ok: false, message: "Reponse MR sans etiquette ou numero d’expedition", raw: data };
  }
  return { ok: true, sendingNumber, etiquetteLink, raw: data };
}

/**
 * Crée une expedition (etiquette PDF / URL) via Connect — corps **XML**, sans Basic Auth (identifiants dans le XML).
 */
export async function createMondialRelayShipmentXml(
  config: MondialRelayConnectEnv,
  shipment: MrShipmentInput,
  outputOptions?: { OutputFormat?: string; OutputType?: string },
): Promise<MrCreateShipmentResult> {
  const xml = shipmentPayloadToXml(
    {
      Login: config.apiLogin,
      Password: config.apiPassword,
      CustomerId: config.brandId,
    },
    shipment,
    outputOptions,
  );

  const url = resolveMondialRelayShipmentUrl(config);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/xml",
      },
      body: xml,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur reseau";
    return { ok: false, message: msg };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, message: `MR HTTP ${response.status} : corps non JSON` };
  }

  if (!response.ok) {
    return { ok: false, message: `MR HTTP ${response.status}`, raw: data };
  }

  return extractResult(data);
}
