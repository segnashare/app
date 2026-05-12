"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ProfileCompleteHeader, type ProfileCompleteMode } from "@/components/profile/ProfileCompleteHeader";
import { ProfileCompleteModifyCore } from "@/components/profile/ProfileCompleteModifyCore";
import { ProfileCompleteVisualizationCore } from "@/components/profile/ProfileCompleteVisualizationCore";
import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeStorageObjectPath } from "@/lib/supabase/storage-resolve-signed-url";
import { cn } from "@/lib/utils/cn";

type OnboardingProfileRequirements = {
  hasPhoto: boolean;
  hasEssentialInfos: boolean;
};

type ProfileCompleteFlowProps = {
  /** Annuler / Terminé : profil ou paramètres selon l’entrée dans le flux. */
  exitHref: string;
  displayName: string;
  completionScore: number;
  showOnboardingProfileHelp?: boolean;
  onboardingProfileRequirements?: OnboardingProfileRequirements | null;
  onboardingProfileNextHref?: string;
};

function getOnboardingProfileHelpCopy(requirements: OnboardingProfileRequirements) {
  const missingPhoto = !requirements.hasPhoto;
  const missingEssentialInfos = !requirements.hasEssentialInfos;
  if (missingPhoto && missingEssentialInfos) {
    return {
      title: "Complète ton profil",
      description:
        "Renseigne tes infos essentielles et ajoute une photo de profil. Pas besoin d’atteindre 100 % pour continuer : on veut juste un profil clair et identifiable.",
      ready: false,
    };
  }
  if (missingPhoto) {
    return {
      title: "Complète ton profil",
      description:
        "Mets une photo de profil. Pas besoin d’atteindre 100 % pour continuer : on veut juste un profil clair et identifiable.",
      ready: false,
    };
  }
  if (missingEssentialInfos) {
    return {
      title: "Complète ton profil",
      description:
        "Renseigne tes infos essentielles. Pas besoin d’atteindre 100 % pour continuer : on veut juste un profil clair et identifiable.",
      ready: false,
    };
  }
  return {
    title: "Valide ton profil",
    description: "Valide ton profil pour passer à l’étape suivante.",
    ready: true,
  };
}

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

async function hasExistingPhotoObject(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  paths: string[],
): Promise<boolean> {
  for (const path of [...new Set(paths)]) {
    if (/^https?:\/\//i.test(path)) return true;
    const objectPath = normalizeStorageObjectPath(path);
    if (!objectPath) continue;
    const { data, error } = await supabase.storage.from("bucket_focus").createSignedUrl(objectPath, 60);
    if (!error && data?.signedUrl) return true;
  }
  return false;
}

async function readOnboardingProfileRequirements(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
): Promise<OnboardingProfileRequirements | null> {
  const [{ data: userRow }, { data: profileRow }] = await Promise.all([
    supabase.from("users").select("first_name").eq("id", userId).maybeSingle(),
    supabase
      .from("user_profiles")
      .select("id, display_name, age, city, photos, profile_data, looks")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!profileRow) return null;

  const profile = profileRow as Record<string, unknown>;
  const profileData = (profile.profile_data ?? {}) as Record<string, unknown>;
  const location = (profileData.location ?? {}) as Record<string, unknown>;
  const profileId = typeof profile.id === "string" ? profile.id : null;
  const { data: sizeRows } = profileId
    ? await supabase.from("user_profile_sizes").select("size_id").eq("user_profile_id", profileId).limit(1)
    : { data: [] };

  const photoPaths = getLooksPhotoPaths(profile);
  const hasPhoto = await hasExistingPhotoObject(supabase, photoPaths);

  return {
    hasPhoto,
    hasEssentialInfos:
      hasDisplayValue(userRow?.first_name ?? profile.display_name) &&
      hasDisplayValue(profile.age) &&
      hasDisplayValue(profile.city ?? location.label) &&
      hasDisplayValue(profileData.work) &&
      Array.isArray(sizeRows) &&
      sizeRows.some((entry: { size_id?: string | null }) => hasDisplayValue(entry.size_id)),
  };
}

export function ProfileCompleteFlow({
  exitHref,
  displayName,
  completionScore,
  showOnboardingProfileHelp = false,
  onboardingProfileRequirements = null,
  onboardingProfileNextHref = "/profile/kyc?tab=me",
}: ProfileCompleteFlowProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ProfileCompleteMode>("edit");
  const [insightsAreComplete, setInsightsAreComplete] = useState(true);
  const [showInsightsValidationError, setShowInsightsValidationError] = useState(false);
  const [previewScore, setPreviewScore] = useState<number | null>(null);
  const [requirements, setRequirements] = useState<OnboardingProfileRequirements | null>(onboardingProfileRequirements);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const displayedScore = previewScore ?? completionScore;
  const onboardingHelpCopy =
    showOnboardingProfileHelp && requirements != null ? getOnboardingProfileHelpCopy(requirements) : null;
  const profileRequirementsReady = requirements != null ? getOnboardingProfileHelpCopy(requirements).ready : false;
  const doneDisabled = !profileRequirementsReady;

  useEffect(() => {
    if (mode === "view") setPreviewScore(null);
  }, [mode]);

  const handleDone = async () => {
    if (mode === "edit" && !insightsAreComplete) {
      setShowInsightsValidationError(true);
      return;
    }
    setShowInsightsValidationError(false);
    setTransitionError(null);
    if (!profileRequirementsReady) {
      setMode("edit");
      setTransitionError("Ajoute une photo et complète les infos essentielles avant de valider ton profil.");
      return;
    }
    if (showOnboardingProfileHelp) {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setTransitionError("Session introuvable.");
        return;
      }
      const liveRequirements = await readOnboardingProfileRequirements(supabase, user.id);
      if (!liveRequirements) {
        setMode("edit");
        setTransitionError("Impossible de vérifier ton profil. Réessaie dans un instant.");
        return;
      }
      setRequirements(liveRequirements);
      if (!getOnboardingProfileHelpCopy(liveRequirements).ready) {
        setMode("edit");
        setTransitionError("Complète les éléments indiqués avant de valider ton profil.");
        return;
      }
      const { error } = await supabase.from("users").update({ onboarding_process: "kyc" }).eq("id", user.id);
      if (error) {
        setTransitionError(error.message);
        return;
      }
      router.push(onboardingProfileNextHref);
      return;
    }
    router.push(exitHref);
  };

  return (
    <div className="min-h-[100dvh] w-full">
      <main className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-white">
        <ProfileCompleteHeader
          exitHref={exitHref}
          displayName={displayName}
          completionScore={displayedScore}
          mode={mode}
          onModeChange={setMode}
          onDone={handleDone}
          doneDisabled={doneDisabled}
        />

        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {onboardingHelpCopy ? (
            <div
              className="mb-4 rounded-2xl border border-zinc-300/90 bg-zinc-50/90 p-4 shadow-[0_8px_30px_rgba(24,24,27,0.08)] backdrop-blur-[2px]"
              role="status"
              aria-live="polite"
            >
              <h2 className={segnaDialogTitleClass()}>{onboardingHelpCopy.title}</h2>
              <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
                {onboardingHelpCopy.description}
              </p>
              {transitionError ? <p className="mt-2 text-[13px] font-medium text-[#E44D3E]">{transitionError}</p> : null}
            </div>
          ) : null}
          {mode === "edit" ? (
            <ProfileCompleteModifyCore
              onInsightsValidityChange={(isComplete) => {
                setInsightsAreComplete(isComplete);
                if (isComplete) setShowInsightsValidationError(false);
              }}
              showInsightsValidationError={showInsightsValidationError}
              onScorePreviewChange={setPreviewScore}
              onOnboardingProfileRequirementsChange={setRequirements}
            />
          ) : (
            <ProfileCompleteVisualizationCore displayName={displayName} />
          )}
        </section>
      </main>
    </div>
  );
}
