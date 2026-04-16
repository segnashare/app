import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileAccountSettings } from "@/components/profile/ProfileAccountSettings";
import { getSegnaSupportContact } from "@/lib/config/support-contact";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

type ProfileSettingsPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const { tab } = await searchParams;
  const safeTab = tab && ["plus", "security", "me"].includes(tab) ? tab : "plus";

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isSubscriber = false;
  if (user?.id) {
    const label = await resolveMembershipLabel(supabase, user.id);
    isSubscriber = label === "Membre +" || label === "Membre X";
  }

  const { email: supportEmail } = getSegnaSupportContact();

  return (
    <SubflowShell>
      <ProfileAccountSettings backTab={safeTab as "plus" | "security" | "me"} isSubscriber={isSubscriber} supportEmail={supportEmail} />
    </SubflowShell>
  );
}
