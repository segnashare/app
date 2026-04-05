"use client";

/**
 * Partie « Échange » du bloc promo CMS (`commerce_promo_ad`).
 * La partie « Panier » est le rail « Des offres pour vous » (`cart_offers`), uniquement sur /cart.
 */
import { CmsFrameItem } from "@/components/cms/CmsSectionBlocks";
import type { CmsFrameRow } from "@/lib/cms/cms-types";

export function ExchangeCommercePromo({ rows }: { rows: CmsFrameRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="bg-white px-4 py-3">
      <div className="space-y-3">
        {rows.map((row) => (
          <CmsFrameItem key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}
