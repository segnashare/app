import Link from "next/link";
import { Plus } from "lucide-react";

import {
  CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS,
  CmsHorizontalScrollRow,
} from "@/components/cms/CmsSectionBlocks";
import { ExchangeLendsEmptyCmsBlock } from "@/components/exchange/ExchangeLendsEmptyCmsBlock";
import { ExchangeLendItemRow } from "@/components/exchange/ExchangeLendItemRow";
import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

/** Aligné sur le tri de `exchange/page.tsx` (mêmes rangs que `lendPipelineRank`). */
function lendPipelineRankForSection(l: LendItem): number {
  const st = l.itemStatus.toLowerCase();
  const ls = l.intake?.listing_stage?.toLowerCase() ?? "";
  const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (st === "refused" || st === "draft_deleted" || ls === "refused" || fs === "refused") return -1;
  if (ls === "validated") {
    if (fs === "verified") return 0;
    if (fs === "in_verification") return 1;
    if (fs === "shipping" || fs === "") return 2;
  }
  if (ls === "validation_pending") return 3;
  if (ls === "evaluated") return 4;
  if (ls === "evaluation") return 5;
  return 6;
}

export type LendItem = {
  id: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  currentValue: number | null;
  itemStatus: string;
  intake?: {
    listing_stage: string;
    fulfillment_stage: string | null;
    /** Pour liens bordereau : fusion MR (`mr_merge_item_ids`) si expédition groupée. */
    metadata?: unknown;
  } | null;
  photoUrl?: string | null;
  photoPosition?: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
};

type ExchangeLendsSectionProps = {
  lends: LendItem[];
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  /** Plafond prêts (depuis user_monthly_entitlements / fallback produit). */
  includedLendsLimit: number;
  /** Pièces déjà validées (intake annonce `validated`). */
  validatedLendsCount: number;
  /** Pièces en expédition membre — si 2–5, proposition d’envoi groupé. */
  mergedShippingCandidateIds: string[];
  /** Bloc CMS `commerce_promo_ad` fusionné sous le titre (abonnés : image seule). */
  promoAdRows?: CmsFrameRow[];
  /** Rail CMS lorsque `lends` est vide (`exchange_lends_empty`), comme panier vide dans Panier actif. */
  emptyLendsCms?: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay } | null;
  emptyLendsCmsCatalogItems?: ShopCatalogItem[];
  guideExchangeOnboarding?: boolean;
};

export function ExchangeLendsSection({
  lends,
  membershipLabel,
  mergedShippingCandidateIds,
  promoAdRows = [],
  emptyLendsCms = null,
  emptyLendsCmsCatalogItems = [],
  guideExchangeOnboarding = false,
  ..._quotaProps
}: ExchangeLendsSectionProps) {
  void _quotaProps;

  const lendPriceCreditKind = walletCreditKindForMembership(membershipLabel);

  const showMergePopup =
    mergedShippingCandidateIds.length >= 2 && mergedShippingCandidateIds.length <= 5;

  const lendsSectionTitle = "Prêts";

  const lendsPreShipping: LendItem[] = [];
  const lendsShippingOnly: LendItem[] = [];
  const lendsAfterShipping: LendItem[] = [];
  for (const item of lends) {
    const r = lendPipelineRankForSection(item);
    if (r <= 1) lendsPreShipping.push(item);
    else if (r === 2) lendsShippingOnly.push(item);
    else lendsAfterShipping.push(item);
  }

  return (
    <SectionBlock
      title={lendsSectionTitle}
      titleEnd={null}
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        {promoAdRows.length > 0 ? (
          <CmsHorizontalScrollRow
            rows={promoAdRows}
            layout="rail"
            hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
            promoVisualOnly
            className="!mt-0"
          />
        ) : null}
        {lends.length === 0 ? (
          <div className="space-y-3">
            {emptyLendsCms && emptyLendsCms.frames.length > 0 ? (
              <ExchangeLendsEmptyCmsBlock
                cms={emptyLendsCms}
                catalogItems={emptyLendsCmsCatalogItems}
                guideExchangeOnboarding={guideExchangeOnboarding}
              />
            ) : null}
          </div>
        ) : null}

        {lendsPreShipping.length + lendsShippingOnly.length > 0 ? (
          <div className="-mx-5 divide-y-[1px] divide-zinc-200">
            {lendsPreShipping.map((item) => (
              <div key={item.id} className="px-5 py-2">
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  creditKind={lendPriceCreditKind}
                />
              </div>
            ))}
            {lendsShippingOnly.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "px-5 py-2",
                  showMergePopup && mergedShippingCandidateIds.includes(item.id)
                    ? "border-b-0 bg-sky-50/55 ring-1 ring-sky-400/80 ring-inset"
                    : "",
                )}
              >
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  creditKind={lendPriceCreditKind}
                />
              </div>
            ))}
          </div>
        ) : null}

        {lendsAfterShipping.length > 0 ? (
          <div className="-mx-5 divide-y-[1px] divide-zinc-200">
            {lendsAfterShipping.map((item) => (
              <div key={item.id} className="px-5 py-2">
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  creditKind={lendPriceCreditKind}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end rounded-xl py-0.5">
          <Link
            href="/items/new?fresh=1"
            className={cn(
              "segna-guidance-shimmer-target inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900",
              guideExchangeOnboarding && "segna-guidance-shimmer-active",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Proposer une pièce
          </Link>
        </div>
      </CardBase>
    </SectionBlock>
  );
}
