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

/**
 * Codes PR hub **destination** retour, dans l’ordre (cascade MR).
 * `MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE` : soit `FR-xxxxxx`, soit un JSON tableau
 * comme `MONDR_RELAY_PREFERRED_JSON` : `[{"code":"FR-…","label":"…"},…]`.
 */
export function getSegnaReturnDeliveryRelayCodesFromEnv(): string[] {
  const raw = process.env.MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      const out: string[] = [];
      for (const el of arr) {
        if (typeof el === "string") {
          const c = el.trim();
          if (c) out.push(c);
        } else if (el && typeof el === "object" && "code" in el) {
          const c = String((el as { code: unknown }).code).trim();
          if (c) out.push(c);
        }
      }
      return out;
    } catch {
      return [];
    }
  }
  return [raw];
}

export function getSegnaReturnRelayProductFromEnv(): RelayDeliveryProduct {
  const rp = (process.env.MONDR_SEGNA_RETURN_RELAY_PRODUCT ?? "LCC").trim().toUpperCase();
  if (rp === "24R" || rp === "24L" || rp === "LCC" || rp === "XOH") return rp;
  return "LCC";
}

