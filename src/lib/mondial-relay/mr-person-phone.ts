import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";

export function withMrNormalizedMobile(person: MrPerson): MrPerson {
  const e164 = normalizeFrenchPhoneToE164(person.MobileNo);
  return {
    ...person,
    MobileNo: e164 ? e164.slice(0, 20) : person.MobileNo.replace(/\s/g, "").trim().slice(0, 20),
  };
}
