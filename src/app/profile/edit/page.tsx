import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileFieldEditClient } from "./ProfileFieldEditClient";

export default function ProfileEditPage() {
  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <ProfileFieldEditClient />
      </Suspense>
    </SubflowShell>
  );
}
