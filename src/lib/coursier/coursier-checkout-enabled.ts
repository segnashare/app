/**
 * Affiche l’option « Aller express - Retour relais » (Coursier.fr) au checkout panier.
 * Mettre `COURSIER_CHECKOUT_ENABLED=0` pour masquer complètement la frame.
 */
export function isCoursierCheckoutEnabled(): boolean {
  const raw = process.env.COURSIER_CHECKOUT_ENABLED?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return true;
}
