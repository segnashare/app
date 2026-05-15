import { MainContent } from "@/components/layout/MainContent";

export default function ShopSectionLoading() {
  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <div className="animate-pulse space-y-4 px-4 py-6">
        <div className="mx-auto h-8 w-48 rounded-lg bg-zinc-200" />
        <div className="mx-auto h-11 max-w-md rounded-xl bg-zinc-200" />
        <div className="grid grid-cols-2 gap-3 pt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl bg-zinc-200" />
          ))}
        </div>
      </div>
    </MainContent>
  );
}
