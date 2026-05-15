import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";

/** Chargement JS du catalogue boutique (dynamic import) ou Suspense page /shop. */
export function ShopCatalogLoadingFallback() {
  return (
    <div className="space-y-4 px-4 pt-4">
      <SegnaSkeletonBlock className="h-10 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SegnaSkeletonBlock key={i} className="aspect-[3/4] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
