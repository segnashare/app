import { Suspense } from "react";

import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { ShippingPageContent } from "./ShippingPageContent";

export default function ShippingTransversePage() {
  return (
    <Suspense fallback={<AppPageLoading label="Chargement de ton envoi" />}>
      <ShippingPageContent />
    </Suspense>
  );
}
