import { Suspense } from "react";

import { OuttakeShippingPageContent } from "./OuttakeShippingPageContent";

export default function OuttakeShippingPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-white" aria-busy="true" />}>
      <OuttakeShippingPageContent />
    </Suspense>
  );
}
