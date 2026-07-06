/** Helpers métadonnées provision retour BO — sans dépendance serveur (importable côté client). */

/** Suivi créé via portail Sendcloud membre (XT…), pas bordereau BO dans le colis aller. */
export function isCartReturnPortalTrackingNumber(trackingNumber: string | null | undefined): boolean {
  const tn = String(trackingNumber ?? "").trim().toUpperCase();
  return tn.startsWith("XT");
}

/** Retour réellement provisionné sur Sendcloud (pas seulement bootstrap portail / copie aller). */
export function isCartReturnSendcloudOrderProvisioned(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  const m = meta && typeof meta === "object" ? meta : {};
  if (m.sendcloud_order_cancelled_at) return false;
  const provisionedAt = m.sc_cart_return_provisioned_at || m.sendcloud_order_provisioned_at;
  if (!provisionedAt) return false;
  return Boolean(String(m.sendcloud_order_number ?? "").trim());
}

/** Bordereau retour déjà imprimé par Segna (glissé dans la pochette aller). */
export function hasPreprintedCartReturnLabel(input: {
  returnShipmentId?: string | null;
  destMeta?: Record<string, unknown> | null;
  outboundDestMeta?: Record<string, unknown> | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
}): boolean {
  if (!input.returnShipmentId?.trim()) return false;
  if (isCartReturnPortalTrackingNumber(input.trackingNumber)) return false;

  const returnMeta = input.destMeta && typeof input.destMeta === "object" ? input.destMeta : {};
  const outboundMeta =
    input.outboundDestMeta && typeof input.outboundDestMeta === "object" ? input.outboundDestMeta : {};

  const portalUrl = String(outboundMeta.sc_cart_return_portal_url ?? "").trim();
  const portalCancelled = Boolean(String(outboundMeta.sc_cart_return_dummy_shipment_cancelled_at ?? "").trim());
  if (portalUrl.startsWith("http") && !portalCancelled) return false;

  if (isCartReturnSendcloudOrderProvisioned(returnMeta)) return true;

  const tn = String(input.trackingNumber ?? "").trim();
  if (tn) return true;

  if (input.labelUrl?.trim() || input.trackingUrl?.trim()) return true;

  const portalBootstrapOnly =
    Boolean(returnMeta.sc_cart_return_portal_bootstrapped_at) &&
    !returnMeta.sc_cart_return_provisioned_at &&
    !returnMeta.sendcloud_order_provisioned_at;
  if (portalBootstrapOnly) return false;

  if (String(returnMeta.sendcloud_order_number ?? "").trim()) return true;

  return false;
}
