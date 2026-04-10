/** Lien suivi colis Mondial Relay (numéro d’envoi / expédition). */
export function buildMondialRelayTrackingUrl(trackingNumber: string): string | null {
  const t = trackingNumber.trim();
  if (!t) return null;
  return `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${encodeURIComponent(t)}`;
}
