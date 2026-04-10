"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CartPanierLineRows } from "@/components/cart/CartPanierLineRows";
import { CMS_SHOP_HUB_FRAME_WIDE_STACK_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { sortCartLinesByPriceAsc } from "@/lib/cart/sort-cart-lines-by-price";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

export type { CartLineStatus } from "@/lib/cart/cart-line-status";
export { CART_LINE_STATUS_CLASSNAMES } from "@/lib/cart/cart-line-status";

type ExchangeCartSectionProps = {
  initialLines: CartLineRowData[];
  activeCartId: string | null;
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  availablePoints: number;
  /** Rail CMS sous le titre « Panier » lorsque le panier est vide (`exchange_cart_empty`). */
  emptyCartCms?: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay } | null;
  emptyCartCmsCatalogItems?: ShopCatalogItem[];
};

export function ExchangeCartSection({
  initialLines,
  activeCartId,
  membershipLabel,
  availablePoints,
  emptyCartCms = null,
  emptyCartCmsCatalogItems = [],
}: ExchangeCartSectionProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const [lines, setLines] = useState<CartLineRowData[]>(() => sortCartLinesByPriceAsc(initialLines));
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [lineRemoveError, setLineRemoveError] = useState<string | null>(null);

  useEffect(() => {
    setLines(sortCartLinesByPriceAsc(initialLines));
  }, [initialLines]);

  const orderedLines = useMemo(() => sortCartLinesByPriceAsc(lines), [lines]);

  const competitionItemIdsKey = useMemo(
    () =>
      [...new Set(lines.map((l) => l.itemId))]
        .sort()
        .join(","),
    [lines],
  );

  useEffect(() => {
    if (!competitionItemIdsKey) return;
    const itemIds = competitionItemIdsKey.split(",").filter(Boolean);
    let cancelled = false;

    async function refreshCompetition() {
      const { data, error } = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIds });
      if (cancelled || error) return;
      setLines((prev) => sortCartLinesByPriceAsc(mergeCompetitionIntoCartLines(prev, data)));
    }

    const channel = supabase
      .channel(`exchange-cart-competition:${competitionItemIdsKey.slice(0, 120)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "items",
          filter: `id=in.(${itemIds.join(",")})`,
        },
        () => void refreshCompetition(),
      )
      .subscribe();

    void refreshCompetition();
    const intervalId = window.setInterval(() => void refreshCompetition(), 12000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [competitionItemIdsKey, supabase]);

  const removeLine = useCallback(
    async (lineId: string) => {
      if (!activeCartId) {
        setLineRemoveError("Panier introuvable.");
        return;
      }
      setLineRemoveError(null);
      setRemovingLineId(lineId);
      try {
        const { data, error } = await supabase
          .from("cart_items")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", lineId)
          .eq("cart_id", activeCartId)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle();
        if (error) {
          setLineRemoveError(error.message ?? "Impossible de retirer cet article.");
          return;
        }
        if (!data) {
          setLineRemoveError("Cette ligne n’a pas pu être retirée.");
          return;
        }
        setLines((prev) => prev.filter((l) => l.id !== lineId));
        try {
          window.dispatchEvent(new CustomEvent("segna:cart-changed"));
        } catch {
          /* noop */
        }
        router.refresh();
      } finally {
        setRemovingLineId(null);
      }
    },
    [activeCartId, router, supabase],
  );

  return (
    <SectionBlock
      title="Panier"
      titleHref="/cart"
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-0">
        {orderedLines.length === 0 ? (
          <div className="space-y-3">
            {emptyCartCms && emptyCartCms.frames.length > 0 ? (
              <CartCmsShopHubProvider catalogItems={emptyCartCmsCatalogItems} onCartMutation={() => router.refresh()}>
                {!emptyCartCms.display.hide_section_title ? (
                  <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                    {emptyCartCms.display.title?.trim() || "Pour commencer"}
                  </h2>
                ) : null}
                <CmsHorizontalScrollRow
                  rows={emptyCartCms.frames}
                  className={emptyCartCms.display.hide_section_title ? "!mt-0" : undefined}
                  hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_STACK_OUTER_CLASS}
                  layout="stack"
                />
              </CartCmsShopHubProvider>
            ) : null}
            <div className="space-y-2">
              <div className="flex justify-end rounded-xl py-0.5">
                <Link
                  href="/shop"
                  className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  <span>Ajouter des articles</span>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <CartPanierLineRows
            lines={orderedLines}
            membershipLabel={membershipLabel}
            availablePoints={availablePoints}
            removingLineId={removingLineId}
            lineRemoveError={lineRemoveError}
            onRemoveLine={(id) => void removeLine(id)}
            showAddArticlesLink
            exchangeUiCalm
          />
        )}
      </CardBase>
    </SectionBlock>
  );
}
