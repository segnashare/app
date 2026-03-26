import { Suspense } from "react";

import { ItemDetailView } from "@/components/item/ItemDetailView";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemDetailsPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ItemDetailView key={id} />
    </Suspense>
  );
}
