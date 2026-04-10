"use client";

/**
 * Partie « Échange » du bloc promo CMS (`commerce_promo_ad`).
 * Gabarit large aligné sur Prêts / panier vide (`w-full` dans la colonne), pas le rail défaut 88vw/90 %.
 * La partie « Panier » est le rail « Des offres pour vous » (`cart_offers`), uniquement sur /cart.
 */
import { CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import type { CmsFrameRow } from "@/lib/cms/cms-types";

export function ExchangeCommercePromo({ rows }: { rows: CmsFrameRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="bg-white px-5 py-4">
      <CmsHorizontalScrollRow
        rows={rows}
        className="!mt-0"
        hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
      />
    </section>
  );
}
