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

export type ProfilePhotoTransform = {
  offset: { x: number; y: number };
  zoom: number;
};

function looksSource(row: Record<string, unknown>): unknown {
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  return row.looks ?? profileData.looks ?? {};
}

function readLookEntryWithPath(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const raw = record.storage_path ?? record.url ?? record.path;
  return typeof raw === "string" && raw.trim().length > 0 ? record : null;
}

/** Première entrée look avec chemin (look1, puis look2, look3). */
export function getFirstLookPhotoEntry(row: Record<string, unknown>): Record<string, unknown> | null {
  const source = looksSource(row);
  if (Array.isArray(source)) {
    for (const entry of source) {
      const look = readLookEntryWithPath(entry);
      if (look) return look;
    }
    return null;
  }
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  return readLookEntryWithPath(record.look1) ?? readLookEntryWithPath(record.look2) ?? readLookEntryWithPath(record.look3);
}

/** Première photo look (onboarding : souvent la PDP si pas de chemin dédié). */
export function getFirstLookPhotoPath(row: Record<string, unknown>): string | null {
  const entry = getFirstLookPhotoEntry(row);
  if (!entry) return null;
  const raw = entry.storage_path ?? entry.url ?? entry.path;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export function parsePhotoTransformRecord(transformRaw: unknown): ProfilePhotoTransform {
  const raw = transformRaw && typeof transformRaw === "object" ? (transformRaw as Record<string, unknown>) : {};
  const offsetRaw = (raw.offset ?? {}) as Record<string, unknown>;
  const zoomRaw = typeof raw.zoom === "number" ? raw.zoom : Number(raw.zoom);
  return {
    offset: {
      x: typeof offsetRaw.x === "number" ? offsetRaw.x : Number(offsetRaw.x) || 0,
      y: typeof offsetRaw.y === "number" ? offsetRaw.y : Number(offsetRaw.y) || 0,
    },
    zoom: Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1,
  };
}

/** Zoom / offset de la photo affichée en PDP (profil dédié ou premier look). */
export function resolveProfilePhotoTransform(row: Record<string, unknown>): ProfilePhotoTransform {
  const usesDedicatedProfile =
    parseUserProfilePhotoPath(row) != null || parseUserProfilePhotoPublicUrl(row.photos) != null;
  if (usesDedicatedProfile) {
    const photos = photosObject(row.photos);
    return parsePhotoTransformRecord(photos.profile_photo_transform);
  }
  const lookEntry = getFirstLookPhotoEntry(row);
  if (lookEntry) return parsePhotoTransformRecord(lookEntry.position);
  return { offset: { x: 0, y: 0 }, zoom: 1 };
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
