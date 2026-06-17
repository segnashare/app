import { Suspense } from "react";

import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { OuttakeShippingPageContent } from "./OuttakeShippingPageContent";

export default function OuttakeShippingPage() {
  return (
    <Suspense fallback={<AppPageLoading label="Chargement de ton retour" />}>
      <OuttakeShippingPageContent />
    </Suspense>
  );
}
