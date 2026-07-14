import PackagePageLegacy from "@/app/package/PackagePageLegacy";
import { PackageSegnaXLandingClient } from "@/app/package/PackageSegnaXLandingClient";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { parseSubscriptionPlanLandingPayload } from "@/lib/cms/subscription-plan-landing";
import { fetchWelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import { getCurrentUserAppState } from "@/lib/auth/current-user-server";
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

  if (plan === "credits") {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const showOfferOnboarding = user?.id
      ? (await getCurrentUserAppState(user.id)).onboarding_process === "offer"
      : false;
    if (!showOfferOnboarding) {
      const { redirect } = await import("next/navigation");
      redirect("/exchange");
    }
  }

  if (plan === "x" || plan === "credits") {
    const supabase = await createSupabaseServerClient();
    const frames = await fetchCmsSectionFramesResolved(supabase, "package_segna_x");
    const landing = frames.find((f) => f.frame_type === "subscription_plan_landing") ?? frames[0];
    const content = parseSubscriptionPlanLandingPayload(landing?.payload);
    const planQuery = plan === "credits" ? "credits" : "x";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const showOfferOnboarding = user?.id
      ? (await getCurrentUserAppState(user.id)).onboarding_process === "offer"
      : false;

    let identityVerifiedForSubscription = true;
    if (plan === "x") {
      if (user?.id) {
        const admin = createSupabaseAdminClient() as any;
        identityVerifiedForSubscription = await fetchUserKycVerified(admin, user.id);
      } else {
        identityVerifiedForSubscription = false;
      }
    }

    const welcomeGiftContent =
      showOfferOnboarding && plan === "credits" ? await fetchWelcomeGiftLandingContent(supabase) : null;

    return (
      <PackageSegnaXLandingClient
        content={content}
        planQuery={planQuery}
        identityVerifiedForSubscription={identityVerifiedForSubscription}
        showOfferOnboarding={showOfferOnboarding}
        welcomeGiftContent={welcomeGiftContent}
      />
    );
  }

  return <PackagePageLegacy />;
}
