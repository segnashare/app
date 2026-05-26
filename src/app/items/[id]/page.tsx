import { Suspense } from "react";

import { ItemDetailView } from "@/components/item/ItemDetailView";
import { getCurrentAuthUser } from "@/lib/auth/current-user-server";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchItemDetailPayloadForUser, type FetchItemDetailResult } from "@/lib/items/fetch-item-detail-core";
import { fetchDefaultIntakeShippingGroupIds } from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  if (user) {
    const [cmsFrames, detailRes] = await Promise.all([
      fetchCmsSectionFramesResolved(supabase, "segna_stock_property"),
      fetchItemDetailPayloadForUser(supabase, user.id, id),
    ]);
    initialSegnaStockPropertyCmsFrames = cmsFrames;
    initialDetailResult = detailRes;
    try {
      const admin = createSupabaseAdminClient();
      const group = await fetchDefaultIntakeShippingGroupIds(admin, user.id, { focusItemId: id });
      if (group.length >= 2) defaultShippingGroupIds = group;
    } catch {
      defaultShippingGroupIds = [];
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
      />
    </Suspense>
  );
}
