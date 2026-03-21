import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ModifyPageClient } from "./ModifyPageClient";

export default function ModifyPage() {
  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <ModifyPageClient />
      </Suspense>
    </SubflowShell>
  );
}
