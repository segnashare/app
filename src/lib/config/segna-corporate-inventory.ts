/**
 * Compte technique « stock Segna » (pas un membre : pas de feed, pas de profil public).
 * Aligné sur segna-backoffice et la migration corporate_inventory.
 */
export const SEGNA_CORPORATE_INVENTORY_USER_ID =
  process.env.NEXT_PUBLIC_SEGNA_CORPORATE_INVENTORY_USER_ID ?? "b2c3d4e5-f6a7-4890-b123-456789abcdef";

export function isSegnaCorporateInventoryUserId(userId: string | null | undefined): boolean {
  return Boolean(userId && userId === SEGNA_CORPORATE_INVENTORY_USER_ID);
}
