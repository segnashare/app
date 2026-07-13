import { notFound } from "next/navigation";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileBlocksClient } from "@/components/profile/ProfileBlocksClient";
import { ProfileCompleteFlow } from "@/components/profile/ProfileCompleteFlow";
import { ProfileKycCore } from "@/components/profile/ProfileKycCore";
import { KYC_INCLUDED_IN_ONBOARDING } from "@/lib/kyc/kyc-policy";
import { fetchOnboardingProfileRequirements } from "@/lib/profile/onboarding-profile-requirements";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_FLOWS = new Set(["complete", "kyc", "reports", "blocks"]);

const FLOW_COPY: Record<string, { title: string; description: string }> = {
  complete: {
    title: "Completer le profil",
    description: "Flow dedie a la completion du profil, sans tabbar globale.",
  },
  kyc: {
    title: "Verification KYC",
    description: "Flow de verification d'identite et selfie.",
  },
  reports: {
    title: "Signalements",
    description: "Gerer les signalements et retours de moderation.",
  },
  blocks: {
    title: "Liste de blocage",
    description: "Gere les profils bloques et restrictions.",
  },
};

type ProfileFlowPageProps = {
  params: Promise<{ flow: string }>;
  searchParams: Promise<{ tab?: string; from?: string }>;
};

export default async function ProfileFlowPage({ params, searchParams }: ProfileFlowPageProps) {
  const { flow } = await params;
  const { tab, from } = await searchParams;
  if (!ALLOWED_FLOWS.has(flow)) {
    notFound();
  }

  const backTab: "plus" | "me" = tab === "me" || tab === "security" ? "me" : tab === "plus" ? "plus" : "plus";
  const copy = FLOW_COPY[flow];

  if (flow === "complete") {
    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let showOnboardingProfileHelp = false;
    let onboardingProfileRequirements: { hasPhoto: boolean; hasEssentialInfos: boolean } | null = null;

    if (user) {
      const { data: userRow } = await supabase.from("users").select("onboarding_process").eq("id", user.id).maybeSingle();
      if (userRow?.onboarding_process === "profile") {
        onboardingProfileRequirements = await fetchOnboardingProfileRequirements(supabase, user.id);
        showOnboardingProfileHelp = true;
      }
    }

    const exitHref = from === "settings" ? `/profile/settings?tab=${encodeURIComponent(backTab)}` : `/profile?tab=${encodeURIComponent(backTab)}`;

    return (
      <SubflowShell>
        <ProfileCompleteFlow
          exitHref={exitHref}
          showOnboardingProfileHelp={showOnboardingProfileHelp}
          onboardingProfileRequirements={onboardingProfileRequirements}
          onboardingProfileNextHref={KYC_INCLUDED_IN_ONBOARDING ? `/profile/kyc?tab=${encodeURIComponent(backTab)}` : "/shop"}
        />
      </SubflowShell>
    );
  }

  if (flow === "kyc") {
    return (
      <SubflowShell>
        <ProfileKycCore backTab={backTab} />
      </SubflowShell>
    );
  }

  if (flow === "blocks") {
    return (
      <SubflowShell>
        <ProfileBlocksClient backTab={backTab} />
      </SubflowShell>
    );
  }

  return (
    <SubflowShell>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-zinc-100">
        <p className="sr-only">{copy.title}</p>
        <div className="rounded-none border-b border-zinc-200 bg-white px-5 py-6">
          <h1 className="text-2xl font-bold text-zinc-900">{copy.title}</h1>
          <p className="mt-2 text-sm text-zinc-600">{copy.description}</p>
          <p className="mt-4 text-sm text-zinc-500">
            Écran à venir. Le contexte d’onglet est conservé via <code className="text-zinc-800">?tab=</code>.
          </p>
        </div>
      </main>
    </SubflowShell>
  );
}
