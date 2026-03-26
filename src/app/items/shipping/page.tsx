import { Suspense } from "react";

import { ShippingPageContent } from "./ShippingPageContent";

export default function ShippingTransversePage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-white" aria-busy="true" />}>
      <ShippingPageContent />
    </Suspense>
  );
}
