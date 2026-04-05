/**
 * Chemins photo profil en base (aligné sur ProfileCompleteModifyCore / RPC).
 */
export function parseUserProfilePhotoPath(row: Record<string, unknown>): string | null {
  const photos = (row.photos ?? {}) as Record<string, unknown>;
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
