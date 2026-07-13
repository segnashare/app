import { normalizeStorageObjectPath } from "@/lib/supabase/storage-resolve-signed-url";
import {
  getFirstLookPhotoPath,
  parseUserProfilePhotoPath,
  parseUserProfilePhotoPublicUrl,
} from "@/lib/profile/parse-profile-photo-path";

/** Même critère que l’onboarding profil : 1 photo + infos essentielles (pas 100 %). */
export type OnboardingProfileRequirements = {
  hasPhoto: boolean;
  hasEssentialInfos: boolean;
};

export function isOnboardingProfileReady(requirements: OnboardingProfileRequirements): boolean {
  return requirements.hasPhoto && requirements.hasEssentialInfos;
}

export function hasProfileDisplayValue(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "À compléter" && trimmed !== "Non renseigné";
}

export function getLooksPhotoPaths(row: Record<string, unknown>): string[] {
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const source = row.looks ?? profileData.looks ?? {};
  const readEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return null;
    const asRecord = entry as Record<string, unknown>;
    const raw = asRecord.storage_path ?? asRecord.url ?? asRecord.path;
    return hasProfileDisplayValue(raw) ? String(raw).trim() : null;
  };
  if (Array.isArray(source)) return source.map(readEntry).filter((path): path is string => Boolean(path));
  if (!source || typeof source !== "object") return [];
  const rec = source as Record<string, unknown>;
  return [rec.look1, rec.look2, rec.look3].map(readEntry).filter((path): path is string => Boolean(path));
}

type StorageSignedUrlClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>;
    };
  };
};

export async function resolveHasProfilePhoto(
  supabase: StorageSignedUrlClient,
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

/** Lecture serveur / client : alignée sur `ProfileCompleteFlow` et l’onboarding. */
export async function fetchOnboardingProfileRequirements(
  supabase: StorageSignedUrlClient & { from: (table: string) => unknown },
  userId: string,
): Promise<OnboardingProfileRequirements | null> {
  const sb = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown }>;
          limit: (n: number) => Promise<{ data: unknown }>;
        };
      };
    };
  };
  const [{ data: userRow }, { data: profileRow }] = await Promise.all([
    sb.from("users").select("first_name").eq("id", userId).maybeSingle(),
    sb
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
    ? await sb.from("user_profile_sizes").select("size_id").eq("user_profile_id", profileId).limit(1)
    : { data: [] as Array<{ size_id?: string | null }> };

  const sizes = Array.isArray(sizeRows) ? sizeRows : [];

  const photoPaths = [
    parseUserProfilePhotoPath(profile),
    getFirstLookPhotoPath(profile),
    ...getLooksPhotoPaths(profile),
  ].filter((path): path is string => Boolean(path));
  const uniquePhotoPaths = [...new Set(photoPaths)];
  const hasPhoto =
    parseUserProfilePhotoPublicUrl(profile.photos) != null ||
    (uniquePhotoPaths.length > 0 && (await resolveHasProfilePhoto(supabase, uniquePhotoPaths)));
  const user = userRow as { first_name?: string | null } | null;

  return {
    hasPhoto,
    hasEssentialInfos:
      hasProfileDisplayValue(user?.first_name ?? profile.display_name) &&
      hasProfileDisplayValue(profile.age) &&
      hasProfileDisplayValue(profile.city ?? location.label) &&
      hasProfileDisplayValue(profileData.work) &&
      sizes.some((entry) => hasProfileDisplayValue(entry.size_id)),
  };
}

export function cartPaymentProfileGateMessage(requirements: OnboardingProfileRequirements | null): string {
  if (!requirements) return "Complète ton profil avant de payer.";
  const missingPhoto = !requirements.hasPhoto;
  const missingInfos = !requirements.hasEssentialInfos;
  if (missingPhoto && missingInfos) {
    return "Ajoute une photo de profil et renseigne tes infos essentielles (prénom, âge, ville, profession, tailles) avant de payer.";
  }
  if (missingPhoto) return "Ajoute une photo de profil avant de payer.";
  if (missingInfos) {
    return "Renseigne tes infos essentielles (prénom, âge, ville, profession, tailles) avant de payer.";
  }
  return "Complète ton profil avant de payer.";
}
