import { notFound } from "next/navigation";

import { InspirationDetailClient } from "@/components/community/InspirationDetailClient";
import { MainContent } from "@/components/layout/MainContent";
import { urlSourceToDbSource } from "@/lib/community/community-source";
import { fetchInspirationDetail } from "@/lib/community/fetch-inspiration-detail";
import { resolveInspirationDetailMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ source: string; id: string }>;
};

export default async function InspirationDetailPage({ params }: PageProps) {
  const { source: urlSource, id } = await params;
  const dbSource = urlSourceToDbSource(urlSource);

  if (!dbSource || !UUID_RE.test(id)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const rawDetail = await fetchInspirationDetail(supabase, dbSource, id);
  if (!rawDetail) notFound();

  const detail = await resolveInspirationDetailMediaUrls(supabase, rawDetail);
  const companionItems = await fetchShopCatalogItemsByIds(supabase, detail.item_ids);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialFavoriteIds: string[] = [];
  if (user && detail.item_ids.length > 0) {
    const { data: favRows } = await supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", user.id)
      .in("item_id", detail.item_ids)
      .is("deleted_at", null);
    initialFavoriteIds = (favRows ?? []).map((row: { item_id: string }) => row.item_id);
  }

  return (
    <MainContent>
      <InspirationDetailClient
        detail={detail}
        companionItems={companionItems}
        initialFavoriteIds={initialFavoriteIds}
      />
    </MainContent>
  );
}
