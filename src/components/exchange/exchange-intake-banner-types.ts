export type ExchangeIntakeBannerItem = {
  id: string;
  title: string | null;
  listingStage: string;
  fulfillmentStage: string | null;
  metadata: unknown;
  updatedAt: string | null;
  pricePoints: number | null;
  /** Lot expédition du transfer de cette pièce (pas le lot global membre). */
  defaultShippingGroupIds?: string[];
  shippingGroupItems?: Array<{ id: string; title: string | null }>;
};
