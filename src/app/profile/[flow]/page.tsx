import Link from "next/link";
import { notFound } from "next/navigation";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileCompleteFlow } from "@/components/profile/ProfileCompleteFlow";
import { ProfileKycCore } from "@/components/profile/ProfileKycCore";
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
    title: "Liste rouge",
    description: "Gerer les profils bloques et restrictions.",
  },
};

type ProfileFlowPageProps = {
  params: Promise<{ flow: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function ProfileFlowPage({ params, searchParams }: ProfileFlowPageProps) {
  const { flow } = await params;
  const { tab } = await searchParams;
  if (!ALLOWED_FLOWS.has(flow)) {
    notFound();
  }

  const backTab = tab && ["plus", "security", "me"].includes(tab) ? tab : "plus";
  const copy = FLOW_COPY[flow];

  if (flow === "complete") {
    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let displayName = "Profil";
    let completionScore = 0;

    if (user) {
      const { data: row } = await supabase.from("user_profiles").select("display_name, score").eq("user_id", user.id).maybeSingle();
      if (typeof row?.display_name === "string" && row.display_name.trim()) {
        displayName = row.display_name.trim();
      }
      if (typeof row?.score === "number") {
        completionScore = Math.max(0, Math.min(100, Math.round(row.score)));
      }
    }

    return (
      <SubflowShell>
        <ProfileCompleteFlow backTab={backTab as "plus" | "security" | "me"} displayName={displayName} completionScore={completionScore} />
      </SubflowShell>
    );
  }

  if (flow === "kyc") {
    return (
      <SubflowShell>
        <ProfileKycCore backTab={backTab as "plus" | "security" | "me"} />
      </SubflowShell>
    );
  }

  return (
    <SubflowShell>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-white px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href={`/profile?tab=${backTab}`} className="inline-flex h-10 items-center text-sm font-medium text-zinc-700 underline">
            Retour au profil
          </Link>
        </header>

        <section className="mt-8 space-y-4">
          <h1 className="text-3xl font-semibold text-zinc-950">{copy.title}</h1>
          <p className="text-base text-zinc-600">{copy.description}</p>
        </section>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Ecran placeholder de flow. Le contexte d'onglet est conserve via <code>?tab=</code>.
        </div>
      </main>
    </SubflowShell>
  );
}
