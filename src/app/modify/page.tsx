import { Suspense } from "react";

import { ModifyPageClient } from "./ModifyPageClient";

export default function ModifyPage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
      <ModifyPageClient />
    </Suspense>
  );
}
