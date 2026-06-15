import { MainContent } from "@/components/layout/MainContent";
import { ShopSectionCatalogLoadingFallback } from "@/components/shop/ShopCatalogLoadingFallback";

export default function ShopCatalogFilterLoading() {
  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopSectionCatalogLoadingFallback />
    </MainContent>
  );
}
