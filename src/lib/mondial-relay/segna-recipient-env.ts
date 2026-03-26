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
