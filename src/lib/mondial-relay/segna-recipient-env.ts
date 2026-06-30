import type { RelayDeliveryProduct } from "@/lib/mondial-relay/build-item-shipment";
import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";

/**
 * Destinataire « hub Segna » pour le XML MR : lu uniquement depuis l’environnement
 * du déploiement (une base logistique par instance BO). Pas de valeurs factices dans le code.
 */
export function getSegnaRecipientFromEnv(): MrPerson | null {
  const Firstname = process.env.MONDR_SEGNA_RECIP_FIRSTNAME?.trim();
  const Lastname = process.env.MONDR_SEGNA_RECIP_LASTNAME?.trim();
  const Streetname = process.env.MONDR_SEGNA_RECIP_STREET?.trim();
  const HouseNo = process.env.MONDR_SEGNA_RECIP_HOUSENO?.trim();
  const CountryCode = process.env.MONDR_SEGNA_RECIP_COUNTRY?.trim();
  const PostCode = process.env.MONDR_SEGNA_RECIP_POSTCODE?.trim();
  const City = process.env.MONDR_SEGNA_RECIP_CITY?.trim();
  const MobileNo = process.env.MONDR_SEGNA_RECIP_MOBILE?.trim();
  const Email = process.env.MONDR_SEGNA_RECIP_EMAIL?.trim();
  const titleRaw = process.env.MONDR_SEGNA_RECIP_TITLE?.trim();

  if (
    !Firstname ||
    !Lastname ||
    !Streetname ||
    !HouseNo ||
    !CountryCode ||
    !PostCode ||
    !City ||
    !MobileNo ||
    !Email
  ) {
    return null;
  }

  return {
    Firstname,
    Lastname,
    Streetname,
    HouseNo,
    CountryCode,
    PostCode,
    City,
    PhoneNo: "",
    MobileNo,
    Email,
    Title: titleRaw === "Mr" ? "Mr" : "Mme",
  };
}

export type SegnaReturnHubRelayEntry = { code: string; label: string };

/**
 * Points relais hub retour Segna (ordre = priorité).
 * `MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE` : `FR-xxxxxx` ou JSON `[{"code":"FR-…","label":"…"},…]`.
 */
export function getSegnaReturnDeliveryRelayHubEntriesFromEnv(): SegnaReturnHubRelayEntry[] {
  const raw = process.env.MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      const out: SegnaReturnHubRelayEntry[] = [];
      for (const el of arr) {
        if (typeof el === "string") {
          const c = el.trim();
          if (c) out.push({ code: c, label: c });
        } else if (el && typeof el === "object" && "code" in el) {
          const c = String((el as { code: unknown }).code).trim();
          const labelRaw =
            "label" in el && typeof (el as { label: unknown }).label === "string"
              ? String((el as { label: unknown }).label).trim()
              : "";
          if (c) out.push({ code: c, label: labelRaw || c });
        }
      }
      return out;
    } catch {
      const m = raw.match(/FR-\d+/i);
      if (m) return [{ code: m[0]!, label: m[0]! }];
      return [];
    }
  }
  return [{ code: raw, label: raw }];
}

/** Codes PR hub **destination** retour, dans l’ordre (cascade MR / Sendcloud). */
export function getSegnaReturnDeliveryRelayCodesFromEnv(): string[] {
  return getSegnaReturnDeliveryRelayHubEntriesFromEnv().map((e) => e.code);
}

export function getSegnaReturnRelayProductFromEnv(): RelayDeliveryProduct {
  const rp = (process.env.MONDR_SEGNA_RETURN_RELAY_PRODUCT ?? "LCC").trim().toUpperCase();
  if (rp === "24R" || rp === "24L" || rp === "LCC" || rp === "XOH") return rp;
  return "LCC";
}

