/** Lignes `order_items` Sendcloud (1 article panier = 1 ligne, valeur déclarée en €). */

export type SendcloudOrderItemInput = {
  title?: string | null;
  brandLabel?: string | null;
  /** Valeur d’échange (mods) — même base que les expéditions MR Segna (1 mod ≈ 1 € déclaré). */
  pricePoints?: number | null;
};

export type SendcloudOrderItemRow = {
  name: string;
  quantity: 1;
  total_price: { value: number; currency: "EUR" };
};

export function formatSendcloudPieceLabel(
  title: string | null | undefined,
  brandLabel?: string | null,
): string {
  const t = (title ?? "").trim() || "Pièce Segna";
  const brand = (brandLabel ?? "").trim();
  return (brand ? `${t} (${brand})` : t).slice(0, 120);
}

export function pieceDeclaredValueEur(pricePoints: number | null | undefined): number {
  const p = Number(pricePoints);
  if (!Number.isFinite(p) || p <= 0) return 1;
  return Math.max(1, Math.round(p));
}

export function buildSendcloudOrderItemsFromLines(lines: SendcloudOrderItemInput[]): {
  orderItems: SendcloudOrderItemRow[];
  totalValueEur: number;
} {
  if (lines.length === 0) {
    return {
      orderItems: [
        {
          name: "Pièce Segna",
          quantity: 1,
          total_price: { value: 1, currency: "EUR" },
        },
      ],
      totalValueEur: 1,
    };
  }

  const orderItems = lines.map((line) => {
    const value = pieceDeclaredValueEur(line.pricePoints);
    return {
      name: formatSendcloudPieceLabel(line.title, line.brandLabel),
      quantity: 1 as const,
      total_price: { value, currency: "EUR" as const },
    };
  });

  const totalValueEur = Math.max(
    1,
    orderItems.reduce((sum, row) => sum + row.total_price.value, 0),
  );

  return { orderItems, totalValueEur };
}

type CartItemJoinRow = {
  items?: {
    title?: string | null;
    price_points?: number | null;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | { label?: string | null }[] | null;
  } | null;
};

export function mapCartItemJoinToSendcloudOrderInput(row: CartItemJoinRow): SendcloudOrderItemInput {
  const item = row.items;
  const brands = item?.item_brands;
  const brandRow = Array.isArray(brands) ? brands[0] : brands;
  return {
    title: item?.title ?? null,
    brandLabel:
      (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      (typeof brandRow?.label === "string" && brandRow.label.trim()) ||
      null,
    pricePoints: item?.price_points ?? null,
  };
}
