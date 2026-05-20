import { formatReseauxSummary, readSocialHandlesFromProfileData } from "@/lib/profile/social-handles";

export type ProfileCompletionSignals = {
  looks: [boolean, boolean, boolean];
  firstNameOk: boolean;
  ageOk: boolean;
  locationOk: boolean;
  workOk: boolean;
  sizesOk: boolean;
  reseauxOk: boolean;
};

/** 3 photos + 6 champs « Mes infos » (prénom, âge, position, profession, tailles, réseaux). */
const COMPLETION_UNIT_COUNT = 9;

function toDisplayOk(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length > 0 && t !== "À compléter" && t !== "Non renseigné";
}

function parseLooksRaw(row: Record<string, unknown>): Array<Record<string, unknown> | null> {
  const profileDataLooks = (row.profile_data as Record<string, unknown> | undefined)?.looks;
  const looksRaw = row.looks;
  const source =
    (Array.isArray(looksRaw) && looksRaw.length > 0) ||
    (looksRaw && typeof looksRaw === "object" && !Array.isArray(looksRaw) && Object.keys(looksRaw as Record<string, unknown>).length > 0)
      ? looksRaw
      : profileDataLooks ?? looksRaw ?? {};
  if (Array.isArray(source)) {
    const normalized = source.slice(0, 3);
    while (normalized.length < 3) normalized.push(null);
    return normalized as Array<Record<string, unknown> | null>;
  }
  if (!source || typeof source !== "object") return [null, null, null];
  const sourceRecord = source as Record<string, unknown>;
  return [sourceRecord.look1, sourceRecord.look2, sourceRecord.look3].map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null));
}

function lookSlotHasPath(raw: Record<string, unknown> | null): boolean {
  if (!raw) return false;
  const storagePathRaw = raw.storage_path ?? raw.url ?? raw.path;
  return typeof storagePathRaw === "string" && storagePathRaw.trim().length > 0;
}

function sizesOkFromRows(
  sizesRows: Array<{ category?: string | null; size_id?: string | null }>,
  sizeById: Map<string, { code: string; label: string }>,
): boolean {
  const displayForSizeId = (sizeId: string) => {
    const sizeRef = sizeId ? sizeById.get(sizeId) : undefined;
    const sizeLabel = sizeRef?.label?.trim();
    if (sizeLabel && sizeLabel.length > 0) return sizeLabel;
    const code = sizeRef?.code?.trim() ?? "";
    if (!code) return "";
    return code.includes(":") ? code.split(":")[1] || code : code;
  };
  const getPartsFor = (category: "top" | "bottom" | "shoes") => {
    return sizesRows
      .filter((entry) => entry.category === category)
      .map((entry) => {
        const sizeId = typeof entry.size_id === "string" ? entry.size_id : "";
        return sizeId ? displayForSizeId(sizeId) : "";
      })
      .filter((part) => part.length > 0);
  };
  const topParts = getPartsFor("top");
  const bottomParts = getPartsFor("bottom");
  const shoesParts = getPartsFor("shoes");
  const sizesValue = [
    topParts.length ? `Haut ${topParts.join(", ")}` : "",
    bottomParts.length ? `Bas ${bottomParts.join(", ")}` : "",
    shoesParts.length ? `Chaussures ${shoesParts.join(", ")}` : "",
  ]
    .filter((entry) => entry.length > 0)
    .join(" · ");
  return toDisplayOk(sizesValue);
}

/** Pseudo Instagram renseigné (seul réseau affiché sur le profil public). */
export function isReseauxFieldComplete(profileData: Record<string, unknown>): boolean {
  const h = readSocialHandlesFromProfileData(profileData);
  return Boolean(h.instagram);
}

export function computeProfileCompletionPercent(s: ProfileCompletionSignals): number {
  let filled = 0;
  for (const v of s.looks) {
    if (v) filled++;
  }
  if (s.firstNameOk) filled++;
  if (s.ageOk) filled++;
  if (s.locationOk) filled++;
  if (s.workOk) filled++;
  if (s.sizesOk) filled++;
  if (s.reseauxOk) filled++;
  const raw = (filled / COMPLETION_UNIT_COUNT) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Recalcule le % de complétion (0–100) à partir de la base et met à jour `user_profiles.score`.
 * Pondération : 3 photos + 6 champs « Mes infos ».
 */
export async function persistProfileCompletionScore(supabase: unknown): Promise<number | null> {
  const sb = supabase as {
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
    from: (t: string) => any;
  };
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return null;

  const { data: row, error } = await sb.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (error || !row) return null;

  const profileRow = row as Record<string, unknown>;
  const profileData = (profileRow.profile_data ?? {}) as Record<string, unknown>;
  const profileId = typeof profileRow.id === "string" ? profileRow.id : null;

  const looksRaw = parseLooksRaw(profileRow);
  const looks: [boolean, boolean, boolean] = [
    lookSlotHasPath(looksRaw[0] ?? null),
    lookSlotHasPath(looksRaw[1] ?? null),
    lookSlotHasPath(looksRaw[2] ?? null),
  ];

  const { data: usersRow } = await sb.from("users").select("first_name,last_name").eq("id", user.id).maybeSingle();
  const usersRec = (usersRow ?? {}) as Record<string, unknown>;
  const firstNameStr =
    typeof usersRec.first_name === "string" && usersRec.first_name.trim().length > 0
      ? usersRec.first_name.trim()
      : typeof profileRow.display_name === "string"
        ? profileRow.display_name.trim()
        : "";
  const firstNameOk = firstNameStr.length > 0;

  const ageOk = toDisplayOk(profileRow.age ?? profileData.age);
  const locationOk = toDisplayOk(profileRow.city ?? (profileData.location as Record<string, unknown> | undefined)?.label);
  const workOk = toDisplayOk(profileData.work);

  const sizesResponse = profileId
    ? await sb.from("user_profile_sizes").select("category, size_id").eq("user_profile_id", profileId)
    : { data: [], error: null };

  const sizesRows = (sizesResponse.data ?? []) as Array<{ category?: string | null; size_id?: string | null }>;
  const sizeIds = Array.from(
    new Set(sizesRows.map((entry) => (typeof entry.size_id === "string" ? entry.size_id : "")).filter((id) => id.length > 0)),
  );
  const { data: sizeItemsRows } =
    sizeIds.length > 0 ? await sb.from("sizes").select("id,code,label").in("id", sizeIds) : { data: [] as Array<{ id: string; code: string | null; label: string | null }> };
  const sizeById = new Map<string, { code: string; label: string }>(
    ((sizeItemsRows ?? []) as Array<{ id?: string | null; code?: string | null; label?: string | null }>)
      .filter((entry): entry is { id: string; code: string | null; label: string | null } => typeof entry.id === "string")
      .map((entry) => [entry.id, { code: entry.code ?? "", label: entry.label ?? "" }]),
  );
  const sizesOk = sizesOkFromRows(sizesRows, sizeById);

  const signals: ProfileCompletionSignals = {
    looks,
    firstNameOk,
    ageOk,
    locationOk,
    workOk,
    sizesOk,
    reseauxOk: isReseauxFieldComplete(profileData),
  };

  const score = computeProfileCompletionPercent(signals);
  const { error: upErr } = await sb.from("user_profiles").update({ score }).eq("user_id", user.id);
  if (upErr) return null;
  return score;
}

type ModifyRow = { id: string; value: string };

function slotLooksFilled(slot: { storagePath?: string | null; dataUrl?: string | null } | null | undefined): boolean {
  if (!slot) return false;
  const p = typeof slot.storagePath === "string" && slot.storagePath.trim().length > 0;
  const u = typeof slot.dataUrl === "string" && slot.dataUrl.trim().length > 0;
  return p || u;
}

/**
 * Aperçu du % depuis l’état local de l’écran « Compléter le profil » (sans aller en base).
 */
export function computeProfileCompletionPreviewPercent(args: {
  looksSlots: Array<{ storagePath?: string | null; dataUrl?: string | null } | null>;
  infoItems: ModifyRow[];
  /** Quand fourni (ex. dernier `profile_data` hydraté), aligne le score sur la même règle que la persistance. */
  reseauxProfileData?: Record<string, unknown> | null;
}): number {
  const looks: [boolean, boolean, boolean] = [
    slotLooksFilled(args.looksSlots[0]),
    slotLooksFilled(args.looksSlots[1]),
    slotLooksFilled(args.looksSlots[2]),
  ];
  const getInfo = (id: string) => args.infoItems.find((i) => i.id === id)?.value ?? "";
  const firstNameOk = toDisplayOk(getInfo("first_name"));
  const ageOk = toDisplayOk(getInfo("age"));
  const locationOk = toDisplayOk(getInfo("location"));
  const workOk = toDisplayOk(getInfo("work"));
  const sizesOk = toDisplayOk(getInfo("sizes"));
  const reseauxVal = getInfo("reseaux").trim();
  const reseauxOk =
    args.reseauxProfileData != null
      ? isReseauxFieldComplete(args.reseauxProfileData)
      : reseauxVal.length > 0 && reseauxVal !== "Non renseigné" && reseauxVal !== "À compléter";
  return computeProfileCompletionPercent({
    looks,
    firstNameOk,
    ageOk,
    locationOk,
    workOk,
    sizesOk,
    reseauxOk,
  });
}

/** Résumé court pour la carte profil (null si aucun réseau). */
export function formatReseauxSummaryOrNull(profileData: Record<string, unknown>): string | null {
  const s = formatReseauxSummary(profileData);
  return s === "Non renseigné" ? null : s;
}
