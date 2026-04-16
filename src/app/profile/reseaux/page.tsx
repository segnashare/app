import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileReseauxClient } from "@/components/profile/ProfileReseauxClient";

export default function ProfileReseauxPage() {
  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <ProfileReseauxClient />
      </Suspense>
    </SubflowShell>
  );
}
