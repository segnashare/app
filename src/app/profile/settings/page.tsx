import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileAccountSettings } from "@/components/profile/ProfileAccountSettings";
import { getSegnaSupportContact } from "@/lib/config/support-contact";
import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel, type MembershipLabel } from "@/lib/user/resolve-membership-label";

type ProfileSettingsPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const { tab } = await searchParams;
  const safeTab: "plus" | "me" =
    tab === "me" || tab === "security" ? "me" : tab === "plus" ? "plus" : "plus";

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isSubscriber = false;
  let membershipLabel: MembershipLabel = "Guest";
  let kycVerified = false;
  if (user?.id) {
    const admin = createSupabaseAdminClient() as any;
    try {
      kycVerified = await fetchUserKycVerified(admin, user.id);
    } catch {
      kycVerified = false;
    }
    membershipLabel = await resolveMembershipLabel(supabase, user.id);
    isSubscriber = membershipLabel === "Membre +" || membershipLabel === "Membre X";
  }

  const { email: supportEmail } = getSegnaSupportContact();

  return (
    <SubflowShell>
      <ProfileAccountSettings
        backTab={safeTab}
        isSubscriber={isSubscriber}
        membershipLabel={membershipLabel}
        kycVerified={kycVerified}
        supportEmail={supportEmail}
      />
    </SubflowShell>
  );
}
