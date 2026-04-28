import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
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
  let initialReferralCode: string | null = null;
  if (user) {
    const { data } = await supabase.from("user_profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    if (typeof data?.display_name === "string" && data.display_name.trim()) {
      initialDisplayName = data.display_name.trim();
    }
    [plusTabCmsFrames, meTabProfileHeroFrames] = await Promise.all([
      fetchCmsSectionFramesResolved(supabase, "profile_plus_tab"),
      fetchCmsSectionFramesResolved(supabase, "profile_me_tab"),
    ]);
    const { data: referralRes } = await supabase.from("referrals_codes").select("code").eq("user_id", user.id).maybeSingle();
    initialReferralCode = typeof referralRes?.code === "string" ? referralRes.code : null;
  }

  return (
    <ProfileTabs
      initialTab={tab}
      initialDisplayName={initialDisplayName}
      initialPlusTabCmsFrames={plusTabCmsFrames}
      initialMeTabProfileHeroFrames={meTabProfileHeroFrames}
      initialReferralCode={initialReferralCode}
    />
  );
}
