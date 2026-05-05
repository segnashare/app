import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileEditContactClient } from "@/components/profile/ProfileEditContactClient";

export default function ProfileEditContactPage() {
  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <ProfileEditContactClient />
      </Suspense>
    </SubflowShell>
  );
}
