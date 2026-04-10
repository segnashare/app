/**
 * Coordonnées affichées sur les écrans commande / emprunt (échange).
 * Définir dans l’environnement : NEXT_PUBLIC_SEGNA_SUPPORT_PHONE, NEXT_PUBLIC_SEGNA_SUPPORT_EMAIL.
 */
export type SegnaSupportContact = {
  phone: string | null;
  email: string | null;
};

export function getSegnaSupportContact(): SegnaSupportContact {
  const phone = process.env.NEXT_PUBLIC_SEGNA_SUPPORT_PHONE?.trim() || null;
  const email =
    process.env.NEXT_PUBLIC_SEGNA_SUPPORT_EMAIL?.trim() || "contact@segnashare.com";
  return { phone, email };
}

export function supportTelHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone.replace(/\s/g, "")}`;
}
