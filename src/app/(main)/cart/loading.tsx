import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";

export default function CartLoading() {
  return (
    <div className="min-h-0 bg-white pb-28 text-zinc-900" aria-busy aria-label="Chargement du panier">
      <div className="space-y-4 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <SegnaSkeletonBlock className="h-7 w-32 rounded-md" rounded="rounded-md" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-2xl border border-zinc-200/80 p-3">
            <SegnaSkeletonBlock className="aspect-[3/4] w-24 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
              <SegnaSkeletonBlock className="h-4 w-full max-w-[12rem] rounded-md" rounded="rounded-md" />
              <SegnaSkeletonBlock className="h-3 w-2/3 max-w-[9rem] rounded-md" rounded="rounded-md" />
              <SegnaSkeletonBlock className="mt-auto h-8 w-28 rounded-full" rounded="rounded-full" />
            </div>
          </div>
        ))}
        <SegnaSkeletonBlock className="h-12 w-full rounded-full" rounded="rounded-full" />
      </div>
    </div>
  );
}
