import { Suspense } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { ItemDetailView } from "@/components/item/ItemDetailView";
import { getCurrentAuthUser } from "@/lib/auth/current-user-server";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchItemDetailPayloadForUser, type FetchItemDetailResult } from "@/lib/items/fetch-item-detail-core";
import { fetchItemOutfitLook, type ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
import { fetchDefaultIntakeShippingGroupIds } from "@/lib/items/intake-cart-return-piggyback";
import { buildOuttakeTransferIdByItemId } from "@/lib/items/member-outtake-groups";
import { buildOuttakeShippingPageHref } from "@/lib/items/outtake-shipping-metadata";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { user } = await getCurrentAuthUser();

  let initialSegnaStockPropertyCmsFrames: Awaited<ReturnType<typeof fetchCmsSectionFramesResolved>> | undefined;
  let initialDetailResult: FetchItemDetailResult | undefined;
  let defaultShippingGroupIds: string[] = [];
  let outtakeTransferId: string | null = null;
  let initialOutfitLook: ItemOutfitLookPayload | null = null;
  let initialOutfitCompanionItems: ShopCatalogItem[] = [];
  let initialOutfitCompanionCoverUrlById: Record<string, string> = {};
  let initialGuestCashRental = false;

  if (user) {
    const membershipLabel = await resolveMembershipLabel(supabase, user.id);
    initialGuestCashRental = isGuestCashRentalMode(membershipLabel);

    const [cmsFrames, detailRes, outfitLook] = await Promise.all([
      fetchCmsSectionFramesResolved(supabase, "segna_stock_property"),
      fetchItemDetailPayloadForUser(supabase, user.id, id),
      fetchItemOutfitLook(supabase, id),
    ]);
    initialSegnaStockPropertyCmsFrames = cmsFrames;
    initialDetailResult = detailRes;
    initialOutfitLook = outfitLook;

    if (outfitLook && outfitLook.companions.length > 0) {
      const companionIds = outfitLook.companions.map((c) => c.item_id);
      initialOutfitCompanionItems = await fetchShopCatalogItemsByIds(supabase, companionIds);
      initialOutfitCompanionCoverUrlById = await resolveShopCatalogCoverUrlsServer(supabase, initialOutfitCompanionItems);
    }
    try {
      const admin = createSupabaseAdminClient();
      const group = await fetchDefaultIntakeShippingGroupIds(admin, user.id, { focusItemId: id });
      if (group.length > 0) defaultShippingGroupIds = group;
      if (detailRes?.ok && detailRes.payload.status?.trim().toLowerCase() === "retired") {
        const map = await buildOuttakeTransferIdByItemId(admin, user.id, [id]);
        outtakeTransferId = map[id] ?? null;
      }
    } catch {
      defaultShippingGroupIds = [];
      outtakeTransferId = null;
    }
  }

  return (
    <Suspense fallback={null}>
      <ItemDetailView
        key={id}
        initialAuthUserId={user?.id ?? null}
        initialDetailResult={initialDetailResult}
        initialSegnaStockPropertyCmsFrames={initialSegnaStockPropertyCmsFrames}
        defaultShippingGroupIds={defaultShippingGroupIds}
        outtakeTransferId={outtakeTransferId}
        initialOutfitLook={initialOutfitLook}
        initialOutfitCompanionItems={initialOutfitCompanionItems}
        initialOutfitCompanionCoverUrlById={initialOutfitCompanionCoverUrlById}
        initialGuestCashRental={initialGuestCashRental}
      />
    </Suspense>
  );
}
