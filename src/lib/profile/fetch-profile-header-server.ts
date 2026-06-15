import { createSignedUrlForStoragePath, type StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

export type ProfileHeaderData = {
  displayName: string;
  completionScore: number;
  avatarUrl: string | null;
  profilePhotoPath: string | null;
  avatarTransform: {
    offset: { x: number; y: number };
    zoom: number;
  };
  kycStatus: "pending" | "rejected" | "verified" | "unknown";
};

function normalizeKycStatus(rawKyc: unknown): ProfileHeaderData["kycStatus"] {
  const normalizedKyc = typeof rawKyc === "string" ? rawKyc.toLowerCase() : "";
  if (normalizedKyc === "verified" || normalizedKyc === "approved" || normalizedKyc === "validated") return "verified";
  if (normalizedKyc === "pending") return "pending";
  if (normalizedKyc === "rejected") return "rejected";
  return "unknown";
}

function getFirstLookPhotoPath(row: Record<string, unknown>): string | null {
  const source = row.looks ?? row.look ?? row.profile_looks;
  const readEntry = (entry: unknown): string | null => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const path = record.storage_path ?? record.storagePath ?? record.photo_path ?? record.path;
    return typeof path === "string" && path.trim() ? path.trim() : null;
  };
  if (Array.isArray(source)) {
    for (const entry of source) {
      const path = readEntry(entry);
      if (path) return path;
    }
    return null;
  }
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  return readEntry(record.look1) ?? readEntry(record.look2) ?? readEntry(record.look3);
}

export function getProfileHeaderFromRow(row: Record<string, unknown> | null | undefined): Partial<ProfileHeaderData> {
  if (!row || typeof row !== "object") return {};
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const rawScore =
    row.score ??
    row.completion_score ??
    profileData.completion_score ??
    profileData.profile_completion ??
    profileData.score ??
    profileData.progress_score;
  const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore);
  const rawKyc = row.kyc_status ?? profileData.kyc_status ?? profileData.verification_status ?? profileData.kyc;
  const displayName = typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : undefined;
  const photos = (row.photos ?? {}) as Record<string, unknown>;
  const avatarFromPhotos =
    (typeof photos.profile_photo_public_url === "string" && photos.profile_photo_public_url.trim()) ||
    (typeof photos.profilePhotoPublicUrl === "string" && photos.profilePhotoPublicUrl.trim()) ||
    "";
  const avatarUrl =
    (typeof row.avatar_url === "string" && row.avatar_url.trim() ? row.avatar_url.trim() : null) ??
    (/^https?:\/\//i.test(avatarFromPhotos) ? avatarFromPhotos : null);
  const photosProfile = (photos.profile ?? {}) as Record<string, unknown>;
  const profilePhotoPathCandidates = [
    photos.profile_photo_path,
    photos.profilePhotoPath,
    photos.photo_path,
    photos.path,
    photosProfile.profile_photo_path,
    photosProfile.profilePhotoPath,
    photosProfile.photo_path,
    photosProfile.path,
  ];
  const profilePhotoPath =
    profilePhotoPathCandidates.find((value) => typeof value === "string" && value.trim().length > 0)?.toString().trim() ??
    null;
  const fallbackLookPhotoPath = getFirstLookPhotoPath(row);
  const transformRaw = (photos.profile_photo_transform ?? {}) as Record<string, unknown>;
  const offsetRaw = (transformRaw.offset ?? {}) as Record<string, unknown>;
  const zoomRaw = typeof transformRaw.zoom === "number" ? transformRaw.zoom : Number(transformRaw.zoom);
  return {
    displayName,
    completionScore: Number.isFinite(numericScore) ? numericScore : undefined,
    avatarUrl,
    avatarTransform: {
      offset: {
        x: typeof offsetRaw.x === "number" ? offsetRaw.x : Number(offsetRaw.x) || 0,
        y: typeof offsetRaw.y === "number" ? offsetRaw.y : Number(offsetRaw.y) || 0,
      },
      zoom: Number.isFinite(zoomRaw) ? zoomRaw : 1,
    },
    profilePhotoPath: profilePhotoPath ?? fallbackLookPhotoPath,
    kycStatus: normalizeKycStatus(rawKyc),
  };
}

export async function fetchProfileHeaderServer(
  supabase: StorageSignClient & {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  },
  userId: string,
  fallbackDisplayName?: string,
): Promise<ProfileHeaderData> {
  const [{ data: userProfileRow }, { data: identityVerificationRow }, { data: onboardingRow }] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_identity_verifications").select("verification_status").eq("user_id", userId).maybeSingle(),
    supabase.from("onboarding_sessions").select("status").eq("user_id", userId).maybeSingle(),
  ]);

  const rawRow = userProfileRow as Record<string, unknown> | null;
  const fromDb = getProfileHeaderFromRow(rawRow);
  let resolvedAvatarUrl = fromDb.avatarUrl ?? null;
  if (typeof fromDb.profilePhotoPath === "string" && fromDb.profilePhotoPath.length > 0) {
    resolvedAvatarUrl = null;
    if (/^https?:\/\//i.test(fromDb.profilePhotoPath)) {
      resolvedAvatarUrl = fromDb.profilePhotoPath;
    } else {
      resolvedAvatarUrl = await createSignedUrlForStoragePath(supabase, fromDb.profilePhotoPath, 60 * 60, {
        explicitBucket: "bucket_focus",
      });
    }
  }

  const kycFromVerification = identityVerificationRow as { verification_status?: string } | null;
  const kycStatus = kycFromVerification?.verification_status
    ? normalizeKycStatus(kycFromVerification.verification_status)
    : (fromDb.kycStatus ?? "unknown");

  const completionFromDb = fromDb.completionScore;
  const completionScore =
    typeof completionFromDb === "number"
      ? Math.max(0, Math.min(100, Math.round(completionFromDb)))
      : (onboardingRow as { status?: string } | null)?.status === "completed"
        ? 100
        : 0;

  return {
    displayName: fromDb.displayName || fallbackDisplayName || "Profil",
    completionScore,
    avatarUrl: resolvedAvatarUrl,
    profilePhotoPath: fromDb.profilePhotoPath ?? null,
    avatarTransform: fromDb.avatarTransform ?? { offset: { x: 0, y: 0 }, zoom: 1 },
    kycStatus,
  };
}
