/** Lien vers la page regroupement / expédition retour membre. */
export function buildOuttakeShippingPageHref(transferId?: string | null): string {
  const tid = transferId?.trim();
  if (tid) return `/items/outtake-shipping?envoi=${encodeURIComponent(tid)}`;
  return "/items/outtake-shipping";
}
