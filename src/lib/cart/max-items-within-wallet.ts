/**
 * Plus grand nombre de pièces dont la somme des points ≤ capacité :
 * prendre les k prix les plus petits (k maximal avec somme ≤ capacité).
 * Tri stable par createdAt puis id pour cohérence avec la RPC Postgres.
 */
export type CartLineForWalletSubset = {
  id: string;
  pricePoints: number;
  createdAtMs: number;
};

export function selectCartLineIdsForMaxCountWithinWallet(
  lines: CartLineForWalletSubset[],
  capacityPoints: number,
): string[] {
  if (lines.length === 0 || capacityPoints <= 0) return [];

  const sorted = [...lines].sort((a, b) => {
    if (a.pricePoints !== b.pricePoints) return a.pricePoints - b.pricePoints;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.id.localeCompare(b.id);
  });

  let sum = 0;
  const chosen: string[] = [];
  for (const line of sorted) {
    const p = Math.max(0, line.pricePoints);
    if (sum + p > capacityPoints) break;
    sum += p;
    chosen.push(line.id);
  }

  return chosen;
}
