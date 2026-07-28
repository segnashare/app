import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { SettingsCommsChannelClient } from "@/components/profile/SettingsCommsChannelClient";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileNotificationsSmsPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  const backTab = tab === "me" || tab === "security" ? "me" : "plus";
  const returnPath = `/profile/settings?tab=${encodeURIComponent(backTab)}`;

  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <SettingsCommsChannelClient channel="sms" returnPath={returnPath} />
      </Suspense>
    </SubflowShell>
  );
}
