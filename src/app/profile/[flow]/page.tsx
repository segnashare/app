import { notFound } from "next/navigation";

import { SubflowShell } from "@/components/layout/SubflowShell";
import { ProfileBlocksClient } from "@/components/profile/ProfileBlocksClient";
import { ProfileCompleteFlow } from "@/components/profile/ProfileCompleteFlow";
import { ProfileKycCore } from "@/components/profile/ProfileKycCore";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeStorageObjectPath } from "@/lib/supabase/storage-resolve-signed-url";

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

function hasDisplayValue(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "À compléter" && trimmed !== "Non renseigné";
}

function getLooksPhotoPaths(row: Record<string, unknown>): string[] {
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const source = row.looks ?? profileData.looks ?? {};
  const readEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return null;
    const asRecord = entry as Record<string, unknown>;
    const raw = asRecord.storage_path ?? asRecord.url ?? asRecord.path;
    return hasDisplayValue(raw) ? String(raw).trim() : null;
  };
  if (Array.isArray(source)) return source.map(readEntry).filter((path): path is string => Boolean(path));
  if (!source || typeof source !== "object") return [];
  const rec = source as Record<string, unknown>;
  return [rec.look1, rec.look2, rec.look3].map(readEntry).filter((path): path is string => Boolean(path));
}

async function hasExistingPhotoObject(supabase: any, paths: string[]): Promise<boolean> {
  for (const path of [...new Set(paths)]) {
    if (/^https?:\/\//i.test(path)) return true;
    const objectPath = normalizeStorageObjectPath(path);
    if (!objectPath) continue;
    const { data, error } = await supabase.storage.from("bucket_focus").createSignedUrl(objectPath, 60);
    if (!error && data?.signedUrl) return true;
  }
  return false;
}

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

    let displayName = "Profil";
    let completionScore = 0;
    let showOnboardingProfileHelp = false;
    let onboardingProfileRequirements: { hasPhoto: boolean; hasEssentialInfos: boolean } | null = null;

    if (user) {
      const [{ data: row }, { data: userRow }] = await Promise.all([
        supabase.from("user_profiles").select("id, display_name, score, age, city, photos, profile_data, looks").eq("user_id", user.id).maybeSingle(),
        supabase.from("users").select("onboarding_process, first_name").eq("id", user.id).maybeSingle(),
      ]);
      if (typeof row?.display_name === "string" && row.display_name.trim()) {
        displayName = row.display_name.trim();
      }
      if (typeof row?.score === "number") {
        completionScore = Math.max(0, Math.min(100, Math.round(row.score)));
      }
      if (userRow?.onboarding_process === "profile") {
        const profileRow = (row ?? {}) as Record<string, unknown>;
        const profileData = (profileRow.profile_data ?? {}) as Record<string, unknown>;
        const location = (profileData.location ?? {}) as Record<string, unknown>;
        const profileId = typeof profileRow.id === "string" ? profileRow.id : null;
        const { data: sizeRows } = profileId
          ? await supabase.from("user_profile_sizes").select("size_id").eq("user_profile_id", profileId).limit(1)
          : { data: [] };

        const hasProfilePhoto = await hasExistingPhotoObject(supabase, getLooksPhotoPaths(profileRow));
        const hasEssentialInfos =
          hasDisplayValue(userRow.first_name ?? profileRow.display_name) &&
          hasDisplayValue(profileRow.age) &&
          hasDisplayValue(profileRow.city ?? location.label) &&
          hasDisplayValue(profileData.work) &&
          Array.isArray(sizeRows) &&
          sizeRows.some((entry: { size_id?: string | null }) => hasDisplayValue(entry.size_id));

        onboardingProfileRequirements = {
          hasPhoto: hasProfilePhoto,
          hasEssentialInfos,
        };
        showOnboardingProfileHelp = true;
      }
    }

    const exitHref = from === "settings" ? `/profile/settings?tab=${encodeURIComponent(backTab)}` : `/profile?tab=${encodeURIComponent(backTab)}`;

    return (
      <SubflowShell>
        <ProfileCompleteFlow
          exitHref={exitHref}
          displayName={displayName}
          completionScore={completionScore}
          showOnboardingProfileHelp={showOnboardingProfileHelp}
          onboardingProfileRequirements={onboardingProfileRequirements}
          onboardingProfileNextHref={`/profile/kyc?tab=${encodeURIComponent(backTab)}`}
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
