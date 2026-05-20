/**
 * Chemins photo profil en base (aligné sur ProfileCompleteModifyCore / RPC).
 */
function photosObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function parseUserProfilePhotoPath(row: Record<string, unknown>): string | null {
  const photos = photosObject(row.photos);
  const photosProfile = (photos.profile ?? {}) as Record<string, unknown>;
  const candidates = [
    photos.profile_photo_path,
    photos.profilePhotoPath,
    photos.photo_path,
    photos.path,
    photosProfile.profile_photo_path,
    photosProfile.profilePhotoPath,
    photosProfile.photo_path,
    photosProfile.path,
  ];
  return candidates.find((v) => typeof v === "string" && (v as string).trim().length > 0)?.toString().trim() ?? null;
}

export function parseUserProfilePhotoPublicUrl(photos: unknown): string | null {
  if (!photos || typeof photos !== "object") return null;
  const p = photos as Record<string, unknown>;
  for (const key of ["profile_photo_public_url", "profilePhotoPublicUrl"] as const) {
    const raw = p[key];
    if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) return raw.trim();
  }
  return null;
}

/** Première photo look (onboarding : souvent la PDP si pas de chemin dédié). */
export function getFirstLookPhotoPath(row: Record<string, unknown>): string | null {
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const source = row.looks ?? profileData.looks ?? {};
  const readEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const raw = record.storage_path ?? record.url ?? record.path;
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
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

export function memberHasProfilePhotoSource(row: Record<string, unknown>): boolean {
  return (
    parseUserProfilePhotoPath(row) != null ||
    parseUserProfilePhotoPublicUrl(row.photos) != null ||
    getFirstLookPhotoPath(row) != null
  );
}

export function resolveProfilePhotoStoragePath(row: Record<string, unknown>): string | null {
  return parseUserProfilePhotoPath(row) ?? getFirstLookPhotoPath(row);
}

export function resolveProfilePhotoHttpUrl(row: Record<string, unknown>): string | null {
  return parseUserProfilePhotoPublicUrl(row.photos);
}
