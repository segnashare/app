import PackagePageLegacy from "@/app/package/PackagePageLegacy";
import { PackageSegnaXLandingClient } from "@/app/package/PackageSegnaXLandingClient";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { parseSubscriptionPlanLandingPayload } from "@/lib/cms/subscription-plan-landing";
import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PackagePageProps = {
  searchParams: Promise<{ plan?: string | string[] }>;
};

export default async function PackagePage({ searchParams }: PackagePageProps) {
  const sp = await searchParams;
  const planRaw = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const plan = planRaw?.trim().toLowerCase() ?? "";

  if (plan === "x" || plan === "credits") {
    const supabase = await createSupabaseServerClient();
    const frames = await fetchCmsSectionFramesResolved(supabase, "package_segna_x");
    const landing = frames.find((f) => f.frame_type === "subscription_plan_landing") ?? frames[0];
    const content = parseSubscriptionPlanLandingPayload(landing?.payload);
    const planQuery = plan === "credits" ? "credits" : "x";

    let identityVerifiedForSubscription = true;
    if (plan === "x") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        const admin = createSupabaseAdminClient() as any;
        identityVerifiedForSubscription = await fetchUserKycVerified(admin, user.id);
      } else {
        identityVerifiedForSubscription = false;
      }
    }

    return (
      <PackageSegnaXLandingClient
        content={content}
        planQuery={planQuery}
        identityVerifiedForSubscription={identityVerifiedForSubscription}
      />
    );
  }

  return <PackagePageLegacy />;
}
