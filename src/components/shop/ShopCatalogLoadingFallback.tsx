import {
  CMS_SHOP_HUB_FRAME_OUTER_CLASS,
  CMS_SHOP_HUB_LINK_CARD_RAIL_CLASS,
  SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS,
} from "@/components/cms/CmsSectionBlocks";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";

function ShopLoadingSectionTitle({ showAction = true }: { showAction?: boolean }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 px-3">
      <SegnaSkeletonBlock className="h-7 w-44 max-w-[70%] rounded-md" rounded="rounded-md" />
      {showAction ? (
        <SegnaSkeletonBlock className="mt-1 h-10 w-10 shrink-0 rounded-full" rounded="rounded-full" />
      ) : null}
    </div>
  );
}

/** Rail « À découvrir » : cartes split `aspect-[2.12]`. */
function ShopLoadingSplitPieceRail() {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-nowrap items-start snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="w-3 shrink-0 snap-start" aria-hidden />
      {[0, 1].map((i) => (
        <SegnaSkeletonBlock
          key={i}
          className={cn(SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS, "aspect-[2.12] min-h-[128px]")}
        />
      ))}
      <div className="w-3 shrink-0 snap-start" aria-hidden />
    </div>
  );
}

/** Rail « Pièces likées » : vignettes carrées côte à côte. */
function ShopLoadingSquarePieceRail() {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-nowrap gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="w-3 shrink-0" aria-hidden />
      {[0, 1].map((i) => (
        <SegnaSkeletonBlock key={i} className="aspect-square w-[48%] min-w-[170px] shrink-0" />
      ))}
      <div className="w-3 shrink-0" aria-hidden />
    </div>
  );
}

/** Rail « Catégories » / grandes cartes lien : gabarit `ShopHubLinkCardFrame`. */
function ShopLoadingLinkCardRail({ count = 3 }: { count?: number }) {
  return (
    <div className={CMS_SHOP_HUB_LINK_CARD_RAIL_CLASS}>
      <div className="w-3 shrink-0 snap-start" aria-hidden />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(CMS_SHOP_HUB_FRAME_OUTER_CLASS, "self-start")}>
          <SegnaSkeletonBlock className="aspect-[2.32] w-full" />
        </div>
      ))}
      <div className="w-3 shrink-0 snap-start" aria-hidden />
    </div>
  );
}

/** Grille « Disponibles » : cartes carrées 2 colonnes. */
function ShopLoadingAvailableGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <SegnaSkeletonBlock key={i} className="aspect-square w-full" />
      ))}
    </div>
  );
}

/** Squelette d'une section hub pendant le chargement progressif. */
export function ShopHubSectionSkeleton({ sectionKey }: { sectionKey: string }) {
  switch (sectionKey) {
    case "shop_section_discover":
    case "shop_section_deals":
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle />
          <ShopLoadingSplitPieceRail />
        </section>
      );
    case "shop_system_liked":
    case "shop_system_for_you":
    case "shop_system_popular":
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle />
          <ShopLoadingSquarePieceRail />
        </section>
      );
    case "shop_section_categories":
    case "shop_section_preferred_brands":
    case "shop_section_french":
    case "shop_home_capsules":
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle showAction={sectionKey !== "shop_home_capsules"} />
          <ShopLoadingLinkCardRail count={sectionKey === "shop_home_capsules" ? 2 : 3} />
        </section>
      );
    case "shop_system_lenders":
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle />
          <div className="grid grid-cols-3 gap-3 px-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SegnaSkeletonBlock key={i} className="mx-auto aspect-square w-20 rounded-full" rounded="rounded-full" />
            ))}
          </div>
        </section>
      );
    case "shop_system_available":
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle />
          <ShopLoadingAvailableGrid />
        </section>
      );
    default:
      return (
        <section className="space-y-3">
          <ShopLoadingSectionTitle />
          <ShopLoadingSquarePieceRail />
        </section>
      );
  }
}

/** Chargement JS du catalogue boutique (dynamic import) ou Suspense page /shop. */
export function ShopCatalogLoadingFallback() {
  return (
    <div className="min-h-0 bg-white text-zinc-900" aria-busy aria-label="Chargement de la boutique">
      <div className="sticky top-0 z-40 bg-white">
        <header className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-8">
          <div className="space-y-3 pb-3">
            <SegnaSkeletonBlock className="h-[52px] w-full rounded-full" rounded="rounded-full" />
          </div>
        </header>
        <div className="border-b border-zinc-200/70 bg-white">
          <div className="flex items-stretch gap-2 py-2 pl-2 pr-0">
            <SegnaSkeletonBlock className="h-11 w-11 shrink-0 rounded-xl" rounded="rounded-xl" />
            <div className="flex min-w-0 flex-1 gap-2 overflow-hidden pr-2">
              {[0, 1, 2, 3].map((i) => (
                <SegnaSkeletonBlock key={i} className="h-11 w-[5.5rem] shrink-0 rounded-xl" rounded="rounded-xl" />
              ))}
            </div>
          </div>
          <SegnaSkeletonBlock className="mx-4 mb-3 mt-1 h-4 w-[min(100%,16rem)] rounded" rounded="rounded" />
        </div>
      </div>

      <div className="min-w-0 bg-white pb-28 pt-4">
        <div className="divide-y divide-zinc-200">
          <div className="min-w-0 px-0 pb-5 pt-2">
            <section className="space-y-3">
              <ShopLoadingSectionTitle />
              <ShopLoadingSplitPieceRail />
            </section>
          </div>
          <div className="min-w-0 px-0 py-5">
            <section className="space-y-3">
              <ShopLoadingSectionTitle />
              <ShopLoadingSquarePieceRail />
            </section>
          </div>
          <div className="min-w-0 px-0 py-5">
            <section className="space-y-3">
              <ShopLoadingSectionTitle />
              <ShopLoadingLinkCardRail />
            </section>
          </div>
          <div className="min-w-0 px-0 py-5">
            <section className="space-y-3">
              <ShopLoadingSectionTitle showAction={false} />
              <ShopLoadingLinkCardRail count={2} />
            </section>
          </div>
          <div className="min-w-0 px-3 py-5">
            <section className="space-y-3">
              <ShopLoadingSectionTitle />
              <ShopLoadingAvailableGrid />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Squelette page section `/shop/[slug]` (grille filtrée). */
export function ShopSectionCatalogLoadingFallback() {
  return (
    <div className="min-h-0 bg-white px-3 pb-28 pt-4" aria-busy aria-label="Chargement de la sélection">
      <div className="mb-4 border-b border-zinc-200 pb-4">
        <div className="relative flex min-h-[52px] items-center justify-center">
          <SegnaSkeletonBlock className="absolute left-0 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg" rounded="rounded-lg" />
          <SegnaSkeletonBlock className="mx-12 h-7 w-40 max-w-[60%] rounded-md" rounded="rounded-md" />
          <SegnaSkeletonBlock
            className="absolute right-0 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full"
            rounded="rounded-full"
          />
        </div>
      </div>
      <ShopLoadingAvailableGrid />
    </div>
  );
}
