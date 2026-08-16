import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { SettingsSubscriptionCancelSurveyClient } from "@/components/profile/SettingsSubscriptionCancelSurveyClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsAbonnementAnnulerPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  const backTab = tab === "me" || tab === "security" ? "me" : "plus";
  const tabQuery = `tab=${encodeURIComponent(backTab)}`;
  const settingsPath = `/profile/settings?${tabQuery}`;
  const managePath = `/profile/settings/abonnement?${tabQuery}`;

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) redirect("/auth/login");

  const membershipLabel = await resolveMembershipLabel(supabase, user.id);
  const isSubscriber = membershipLabel === "Membre +" || membershipLabel === "Membre X";
  if (!isSubscriber) redirect(settingsPath);

  const admin = createSupabaseAdminClient() as any;
  const { data: subRow } = await admin
    .from("user_subscriptions")
    .select("cancel_at_period_end")
    .eq("user_id", user.id)
    .eq("provider", "stripe")
    .maybeSingle();

  if (Boolean(subRow?.cancel_at_period_end)) redirect(managePath);

  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <SettingsSubscriptionCancelSurveyClient returnPath={settingsPath} managePath={managePath} />
      </Suspense>
    </SubflowShell>
  );
}
