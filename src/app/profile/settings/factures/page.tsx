import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { SettingsSubscriptionInvoicesClient } from "@/components/profile/SettingsSubscriptionInvoicesClient";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsFacturesPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  const backTab = tab === "me" || tab === "security" ? "me" : "plus";
  const returnPath = `/profile/settings?tab=${encodeURIComponent(backTab)}`;

  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <SettingsSubscriptionInvoicesClient returnPath={returnPath} />
      </Suspense>
    </SubflowShell>
  );
}
