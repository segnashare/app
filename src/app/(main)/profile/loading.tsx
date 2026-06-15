import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";

export default function ProfileLoading() {
  return (
    <div className="min-h-0 bg-white pb-28 text-zinc-900" aria-busy aria-label="Chargement du profil">
      <div className="space-y-4 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <SegnaSkeletonBlock className="mx-auto h-20 w-20 rounded-full" rounded="rounded-full" />
        <SegnaSkeletonBlock className="mx-auto h-6 w-40 max-w-[70%] rounded-md" rounded="rounded-md" />
        <div className="flex justify-center gap-2 pt-2">
          {[0, 1, 2].map((i) => (
            <SegnaSkeletonBlock key={i} className="h-9 w-20 rounded-full" rounded="rounded-full" />
          ))}
        </div>
        <SegnaSkeletonBlock className="mt-4 aspect-[1.6] w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SegnaSkeletonBlock key={i} className="aspect-square w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
