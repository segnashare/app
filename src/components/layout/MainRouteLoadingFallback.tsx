import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";

/** Fallback léger pour les navigations entre onglets (évite l’écran spinner plein page). */
export function MainRouteLoadingFallback() {
  return (
    <div className="min-h-0 bg-white pb-28 pt-4 text-zinc-900" aria-busy aria-label="Chargement">
      <div className="space-y-5 px-4">
        <SegnaSkeletonBlock className="h-12 w-full rounded-full" rounded="rounded-full" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SegnaSkeletonBlock key={i} className="aspect-square w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
