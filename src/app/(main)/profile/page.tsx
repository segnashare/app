import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { PageImageReadyShell } from "@/components/ui/PageImageReadyShell";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { collectProfilePreloadUrls } from "@/lib/page-preload/collect-page-preload-urls";
import { fetchProfileHeaderServer } from "@/lib/profile/fetch-profile-header-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfilePageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { tab } = await searchParams;
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialDisplayName: string | undefined;
  let plusTabCmsFrames: Awaited<ReturnType<typeof fetchCmsSectionFramesResolved>> = [];
  let meTabProfileHeroFrames: Awaited<ReturnType<typeof fetchCmsSectionFramesResolved>> = [];
  let referralBannerFrames: Awaited<ReturnType<typeof fetchCmsSectionFramesResolved>> = [];
  let initialReferralCode: string | null = null;
  let initialHeaderData: Awaited<ReturnType<typeof fetchProfileHeaderServer>> | null = null;

  if (user) {
    const { data } = await supabase.from("user_profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    if (typeof data?.display_name === "string" && data.display_name.trim()) {
      initialDisplayName = data.display_name.trim();
    }
    [plusTabCmsFrames, meTabProfileHeroFrames, referralBannerFrames, initialHeaderData] = await Promise.all([
      fetchCmsSectionFramesResolved(supabase, "profile_plus_tab"),
      fetchCmsSectionFramesResolved(supabase, "profile_me_tab"),
      fetchCmsSectionFramesResolved(supabase, "profile_referral_banner"),
      fetchProfileHeaderServer(supabase, user.id, initialDisplayName),
    ]);
    const { data: referralRes } = await supabase.from("referrals_codes").select("code").eq("user_id", user.id).maybeSingle();
    initialReferralCode = typeof referralRes?.code === "string" ? referralRes.code : null;
  }

  const preloadImageUrls = collectProfilePreloadUrls({
    plusTabCmsFrames,
    meTabProfileHeroFrames,
    referralBannerFrames,
    avatarUrl: initialHeaderData?.avatarUrl,
  });

  return (
    <PageImageReadyShell preloadUrls={preloadImageUrls} loadingLabel="Chargement du profil">
      <ProfileTabs
        initialTab={tab}
        initialDisplayName={initialDisplayName}
        initialHeaderData={initialHeaderData ?? undefined}
        initialPlusTabCmsFrames={plusTabCmsFrames}
        initialMeTabProfileHeroFrames={meTabProfileHeroFrames}
        initialReferralBannerFrames={referralBannerFrames}
        initialReferralCode={initialReferralCode}
      />
    </PageImageReadyShell>
  );
}
