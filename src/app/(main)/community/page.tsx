import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CardBase } from "@/components/layout/CardBase";
import { MainContent } from "@/components/layout/MainContent";
import { CommunityShareActions } from "@/components/community/CommunityShareActions";

export default async function CommunityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let referralCode: string | null = null;

  if (user) {
    const { data: referralRes } = await supabase.from("referrals_codes").select("code").eq("user_id", user.id).maybeSingle();
    referralCode = typeof referralRes?.code === "string" ? referralRes.code : null;
  }

  return (
    <MainContent>
      <div className="space-y-5 pt-4">
        <section className="space-y-3">
          <CardBase className="space-y-3">
            <CommunityShareActions referralCode={referralCode} />
          </CardBase>
        </section>

        <section className="space-y-3">
          <CardBase className="space-y-2">
            <p className="text-sm text-zinc-500">Ton code</p>
            <p className="inline-flex w-fit rounded-lg bg-[#F8F1EC] px-3 py-2 text-base font-semibold text-[#5E3023]">
              {referralCode ?? "Code indisponible"}
            </p>
          </CardBase>
        </section>
      </div>
    </MainContent>
  );
}
