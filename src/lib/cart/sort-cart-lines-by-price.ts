/** Toujours du moins cher au plus cher (stable par `id`). */
export function sortCartLinesByPriceAsc<T extends { pricePoints: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.pricePoints !== b.pricePoints) return a.pricePoints - b.pricePoints;
    return a.id.localeCompare(b.id);
  });
}
