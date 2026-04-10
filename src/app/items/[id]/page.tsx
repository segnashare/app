import { Suspense } from "react";

import { ItemDetailView } from "@/components/item/ItemDetailView";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const initialSegnaStockPropertyCmsFrames = user
    ? await fetchCmsSectionFramesResolved(supabase, "segna_stock_property")
    : undefined;

  return (
    <Suspense fallback={null}>
      <ItemDetailView key={id} initialSegnaStockPropertyCmsFrames={initialSegnaStockPropertyCmsFrames} />
    </Suspense>
  );
}
