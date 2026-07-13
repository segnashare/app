import { notFound } from "next/navigation";

import { LookDetailView } from "@/components/look/LookDetailView";
import { fetchInspirationDetail } from "@/lib/community/fetch-inspiration-detail";
import { resolveInspirationDetailMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import { fetchLookRelatedStyleLooks } from "@/lib/items/fetch-item-style-looks";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function LookDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  let rawDetail = await fetchInspirationDetail(supabase, "member", id);
  if (!rawDetail) {
    rawDetail = await fetchInspirationDetail(supabase, "segna_style", id);
  }
  if (!rawDetail) notFound();

  const detail = await resolveInspirationDetailMediaUrls(supabase, rawDetail);
  const companionItems = await fetchShopCatalogItemsByIds(supabase, detail.item_ids);
  const [coverUrlById, relatedLooks] = await Promise.all([
    resolveShopCatalogCoverUrlsServer(supabase, companionItems),
    detail.source === "segna_style" ? fetchLookRelatedStyleLooks(supabase, id) : Promise.resolve([]),
  ]);

  return (
    <LookDetailView
      detail={detail}
      companionItems={companionItems}
      initialCoverUrlById={coverUrlById}
      relatedLooks={relatedLooks}
    />
  );
}
