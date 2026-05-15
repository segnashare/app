/**
 * Parse la colonne JSON `items.photos` (clés photo1, photo2, …) pour résolution d’URL signée.
 */
export function parsePhotoEntriesFromItemPhotos(raw: unknown): Array<Record<string, unknown>> {
  let rawPhotos: unknown = raw;
  if (typeof rawPhotos === "string") {
    const t = rawPhotos.trim();
    if (!t) return [];
    try {
      rawPhotos = JSON.parse(t) as unknown;
    } catch {
      return [];
    }
  }
  if (!rawPhotos) return [];
  if (Array.isArray(rawPhotos)) {
    return (rawPhotos as unknown[]).filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object") as Array<
      Record<string, unknown>
    >;
  }
  if (typeof rawPhotos !== "object") return [];
  const photos = rawPhotos as Record<string, unknown>;
  return Object.entries(photos)
    .filter(([key, value]) => key.toLowerCase().startsWith("photo") && value && typeof value === "object")
    .sort(([keyA], [keyB]) => {
      const indexA = Number(keyA.toLowerCase().replace("photo", ""));
      const indexB = Number(keyB.toLowerCase().replace("photo", ""));
      if (Number.isNaN(indexA) || Number.isNaN(indexB)) return keyA.localeCompare(keyB);
      return indexA - indexB;
    })
    .map(([, value]) => value as Record<string, unknown>);
}

/**
 * Chemin storage ou URL absolue pour la couverture (même heuristique que panier / exchange).
 * Certaines pièces n’ont que `main_url` / `url` à la racine, ou un tableau `entries`, sans clés `photoN`.
 */
export function getFirstPhotoStoragePath(rawPhotos: unknown): string | null {
  let raw: unknown = rawPhotos;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    try {
      raw = JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  /** Certaines lignes stockent directement un tableau `[{ storage_path, … }]` sans clés `photoN`. */
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const urlCandidate =
        row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl ?? row.path;
      if (typeof urlCandidate === "string" && urlCandidate.trim()) {
        return urlCandidate.trim();
      }
    }
    return null;
  }
  if (typeof raw !== "object") return null;
  const photos = raw as Record<string, unknown>;

  const rootCandidates = [
    photos.main_url,
    photos.mainUrl,
    photos.cover_url,
    photos.coverUrl,
    photos.primary_url,
    photos.primaryUrl,
    photos.url,
  ];
  for (const candidate of rootCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const entries = parsePhotoEntriesFromItemPhotos(photos);
  const first = entries[0];
  if (first) {
    const storagePathRaw = first.storage_path ?? first.storagePath ?? first.url ?? first.photo_url ?? first.photoUrl;
    if (typeof storagePathRaw === "string" && storagePathRaw.trim()) {
      return storagePathRaw.trim();
    }
  }

  const list = photos.entries;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const urlCandidate = row.url ?? row.photo_url ?? row.photoUrl ?? row.storage_path ?? row.storagePath;
      if (typeof urlCandidate === "string" && urlCandidate.trim()) {
        return urlCandidate.trim();
      }
    }
  }

  return null;
}
