import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { MainContent } from "@/components/layout/MainContent";
import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { loadCommunityInspirationsByTagPageSlug } from "@/lib/community/load-community-tag-page";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CommunityTagPage({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const pageSlug = rawSlug.trim();
  if (!pageSlug) notFound();

  const supabase = await createSupabaseServerClient();
  const tagPack = await loadCommunityInspirationsByTagPageSlug(
    supabase as unknown as Parameters<typeof loadCommunityInspirationsByTagPageSlug>[0],
    pageSlug,
  );
  if (!tagPack.tag) notFound();

  const cards = await resolveInspirationCardsMediaUrls(supabase, tagPack.cards);

  return (
    <MainContent className="space-y-4 pb-28">
      <Link href="/community" className="inline-flex items-center gap-1 text-[14px] font-medium text-zinc-700">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Communauté
      </Link>

      <div>
        <h1 className={cn(SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay.className)}>{tagPack.tag.label}</h1>
      </div>

      <InspirationMasonryGrid cards={cards} />
    </MainContent>
  );
}
