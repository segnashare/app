import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { SettingsSubscriptionManageClient } from "@/components/profile/SettingsSubscriptionManageClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsAbonnementPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  const backTab = tab === "me" || tab === "security" ? "me" : "plus";
  const tabQuery = `tab=${encodeURIComponent(backTab)}`;
  const returnPath = `/profile/settings?${tabQuery}`;

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) redirect("/auth/login");

  const membershipLabel = await resolveMembershipLabel(supabase, user.id);
  const isSubscriber = membershipLabel === "Membre +" || membershipLabel === "Membre X";
  if (!isSubscriber) redirect(returnPath);

  const admin = createSupabaseAdminClient() as any;
  const { data: subRow } = await admin
    .from("user_subscriptions")
    .select("current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .eq("provider", "stripe")
    .maybeSingle();

  const planBadge = membershipLabel === "Membre X" ? "SegnaX" : membershipLabel === "Membre +" ? "Segna+" : null;
  const packageHref = membershipLabel === "Membre X" ? "/package?plan=x" : "/package";

  return (
    <SubflowShell>
      <Suspense fallback={<main className="min-h-[100dvh] bg-white" />}>
        <SettingsSubscriptionManageClient
          returnPath={returnPath}
          packageHref={packageHref}
          cancelSurveyHref={`/profile/settings/abonnement/annuler?${tabQuery}`}
          planBadge={planBadge}
          periodEnd={typeof subRow?.current_period_end === "string" ? subRow.current_period_end : null}
          cancelAtPeriodEnd={Boolean(subRow?.cancel_at_period_end)}
        />
      </Suspense>
    </SubflowShell>
  );
}
