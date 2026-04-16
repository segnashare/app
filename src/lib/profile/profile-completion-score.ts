import { parseUserProfilePhotoPath } from "@/lib/profile/parse-profile-photo-path";
import { formatReseauxSummary, readSocialHandlesFromProfileData } from "@/lib/profile/social-handles";

/** Préférences comptées hors « style » (déjà pris via styleItems / section style). */
const SCORE_PREF_SECTIONS = ["motivation", "experience", "share", "budget", "dressing", "ethic"] as const;

export type ProfileCompletionSignals = {
  hasProfilePhoto: boolean;
  looks: [boolean, boolean, boolean];
  insights: [boolean, boolean, boolean];
  firstNameOk: boolean;
  ageOk: boolean;
  locationOk: boolean;
  workOk: boolean;
  sizesOk: boolean;
  reseauxOk: boolean;
  brandsOk: boolean;
  styleOk: boolean;
  prefsOk: boolean[];
};

/** 1 photo + 3 looks + 3 insights + 6 infos + marques + style + 6 prefs = 21 */
const COMPLETION_UNIT_COUNT = 21;

function toDisplayOk(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length > 0 && t !== "À compléter" && t !== "Non renseigné";
}

function toPreferenceDisplayOk(value: unknown, customText: unknown): boolean {
  const custom = typeof customText === "string" && customText.trim().length > 0 ? customText.trim() : "";
  if (Array.isArray(value)) {
    const labels = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
    const base = labels.join(", ");
    const label = custom ? (base ? `${base} (${custom})` : custom) : base;
    return label.length > 0 && label !== "À compléter";
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const base = value.trim();
    const label = custom ? `${base} (${custom})` : base;
    return label !== "À compléter";
  }
  if (custom) return custom !== "À compléter";
  return false;
}

function getPreferenceSection(row: Record<string, unknown>, section: string): { value: unknown; customText: unknown } {
  const sectionRaw = row[section];
  if (sectionRaw && typeof sectionRaw === "object" && !Array.isArray(sectionRaw)) {
    const asRecord = sectionRaw as Record<string, unknown>;
    const nestedPreference = (asRecord.preference ?? null) as Record<string, unknown> | null;
    return {
      value: asRecord.value ?? nestedPreference?.value ?? row[`${section}_value`],
      customText: asRecord.custom_text ?? asRecord.custom ?? nestedPreference?.custom_text ?? nestedPreference?.custom ?? row[`${section}_custom_text`],
    };
  }
  return {
    value: row[`${section}_value`],
    customText: row[`${section}_custom_text`],
  };
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

function parseAnswers(row: Record<string, unknown>): Array<{ prompt: string; response: string }> {
  const src = row.answers ?? ((row.profile_data as Record<string, unknown> | undefined)?.answers ?? []);
  if (!Array.isArray(src)) return [{ prompt: "", response: "" }, { prompt: "", response: "" }, { prompt: "", response: "" }];
  return Array.from({ length: 3 }).map((_, index) => {
    const entry = src[index];
    if (!entry || typeof entry !== "object") return { prompt: "", response: "" };
    const asRecord = entry as Record<string, unknown>;
    return {
      prompt: typeof asRecord.prompt === "string" ? asRecord.prompt : "",
      response: typeof asRecord.response === "string" ? asRecord.response : "",
    };
  });
}

function insightSlotComplete(slot: { prompt: string; response: string }): boolean {
  const p = slot.prompt.trim().length > 0;
  const r = slot.response.trim().length > 0;
  return p && r;
}

function hasPublicProfilePhoto(row: Record<string, unknown>): boolean {
  if (parseUserProfilePhotoPath(row)) return true;
  const photos = (row.photos ?? {}) as Record<string, unknown>;
  const u =
    (typeof photos.profile_photo_public_url === "string" && photos.profile_photo_public_url.trim()) ||
    (typeof photos.profilePhotoPublicUrl === "string" && photos.profilePhotoPublicUrl.trim()) ||
    "";
  return /^https?:\/\//i.test(u);
}

function sizesOkFromRows(
  sizesRows: Array<{ category?: string | null; size_id?: string | null }>,
  sizeById: Map<string, { code: string; label: string }>,
): boolean {
  const getSizeFor = (category: "top" | "bottom" | "shoes") => {
    const rowForCategory = sizesRows.find((entry) => entry.category === category);
    const sizeId = typeof rowForCategory?.size_id === "string" ? rowForCategory.size_id : "";
    const sizeRef = sizeId ? sizeById.get(sizeId) : undefined;
    const sizeLabel = sizeRef?.label?.trim();
    if (sizeLabel && sizeLabel.length > 0) return sizeLabel;
    const code = sizeRef?.code?.trim() ?? "";
    if (!code) return "";
    return code.includes(":") ? code.split(":")[1] || code : code;
  };
  const topSize = getSizeFor("top");
  const bottomSize = getSizeFor("bottom");
  const shoesSize = getSizeFor("shoes");
  const sizesValue = [topSize ? `Haut ${topSize}` : "", bottomSize ? `Bas ${bottomSize}` : "", shoesSize ? `Chaussures ${shoesSize}` : ""]
    .filter((entry) => entry.length > 0)
    .join(" · ");
  return toDisplayOk(sizesValue);
}

/** Au moins un pseudo / lien réseau renseigné (champ unique « Réseaux »). */
export function isReseauxFieldComplete(profileData: Record<string, unknown>): boolean {
  const h = readSocialHandlesFromProfileData(profileData);
  return Boolean(h.instagram || h.tiktok || h.pinterest || h.threads);
}

export function computeProfileCompletionPercent(s: ProfileCompletionSignals): number {
  let filled = 0;
  if (s.hasProfilePhoto) filled++;
  for (const v of s.looks) {
    if (v) filled++;
  }
  for (const v of s.insights) {
    if (v) filled++;
  }
  if (s.firstNameOk) filled++;
  if (s.ageOk) filled++;
  if (s.locationOk) filled++;
  if (s.workOk) filled++;
  if (s.sizesOk) filled++;
  if (s.reseauxOk) filled++;
  if (s.brandsOk) filled++;
  if (s.styleOk) filled++;
  for (const v of s.prefsOk) {
    if (v) filled++;
  }
  const raw = (filled / COMPLETION_UNIT_COUNT) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Recalcule le % de complétion (0–100) à partir de la base et met à jour `user_profiles.score`.
 * Pondération : 21 blocs égaux (photo, 3 looks, 3 insights, 6 infos dont réseaux si ≥1 réseau, marques, style, 6 prefs).
 */
export async function persistProfileCompletionScore(supabase: unknown): Promise<number | null> {
  const sb = supabase as {
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
    from: (t: string) => any;
    rpc: (name: string, args?: unknown) => Promise<{ data?: unknown; error?: { message: string } | null }>;
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

  const answers = parseAnswers(profileRow);
  const insights: [boolean, boolean, boolean] = [
    insightSlotComplete(answers[0] ?? { prompt: "", response: "" }),
    insightSlotComplete(answers[1] ?? { prompt: "", response: "" }),
    insightSlotComplete(answers[2] ?? { prompt: "", response: "" }),
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

  const [brandsResponse, sizesResponse, prefsPayload] = await Promise.all([
    profileId
      ? sb.from("user_profile_brands").select("brand_id, rank").eq("user_profile_id", profileId).order("rank", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    profileId
      ? sb.from("user_profile_sizes").select("category, size_id").eq("user_profile_id", profileId)
      : Promise.resolve({ data: [], error: null }),
    sb.rpc("get_user_preferences_payload"),
  ]);

  const brandsRows = (brandsResponse.data ?? []) as Array<{ brand_id?: string | null }>;
  const brandIds = Array.from(
    new Set(brandsRows.map((entry) => (typeof entry.brand_id === "string" ? entry.brand_id : "")).filter((id) => id.length > 0)),
  );
  const { data: brandItemsRows } =
    brandIds.length > 0 ? await sb.from("item_brands").select("id,label").in("id", brandIds) : { data: [] as Array<{ id: string; label: string | null }> };
  const brandLabelById = new Map<string, string>(
    ((brandItemsRows ?? []) as Array<{ id?: string | null; label?: string | null }>)
      .filter((entry): entry is { id: string; label: string | null } => typeof entry.id === "string")
      .map((entry) => [entry.id, entry.label ?? ""]),
  );
  const brandsValue = brandsRows
    .map((entry) => {
      const id = typeof entry.brand_id === "string" ? entry.brand_id : "";
      return id ? brandLabelById.get(id) ?? "" : "";
    })
    .filter((label) => label.trim().length > 0)
    .join(", ");
  const brandsOk = toDisplayOk(brandsValue);

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

  const userPreferencesRow = (prefsPayload?.data ?? {}) as Record<string, unknown>;
  const styleSection = getPreferenceSection(userPreferencesRow, "style");
  const styleOk = toPreferenceDisplayOk(styleSection.value, styleSection.customText);

  const prefsOk = SCORE_PREF_SECTIONS.map((section) => {
    const { value, customText } = getPreferenceSection(userPreferencesRow, section);
    return toPreferenceDisplayOk(value, customText);
  });

  const signals: ProfileCompletionSignals = {
    hasProfilePhoto: hasPublicProfilePhoto(profileRow),
    looks,
    insights,
    firstNameOk,
    ageOk,
    locationOk,
    workOk,
    sizesOk,
    reseauxOk: isReseauxFieldComplete(profileData),
    brandsOk,
    styleOk,
    prefsOk,
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
  profilePhoto: { storagePath?: string | null; dataUrl?: string | null } | null;
  looksSlots: Array<{ storagePath?: string | null; dataUrl?: string | null } | null>;
  answersForSave: Array<{ prompt: string; response: string }>;
  infoItems: ModifyRow[];
  styleItems: ModifyRow[];
  preferenceItems: ModifyRow[];
  /** Quand fourni (ex. dernier `profile_data` hydraté), aligne le score sur la même règle que la persistance. */
  reseauxProfileData?: Record<string, unknown> | null;
}): number {
  const hasProfilePhoto = slotLooksFilled(args.profilePhoto);
  const looks: [boolean, boolean, boolean] = [
    slotLooksFilled(args.looksSlots[0]),
    slotLooksFilled(args.looksSlots[1]),
    slotLooksFilled(args.looksSlots[2]),
  ];
  const insights: [boolean, boolean, boolean] = [
    insightSlotComplete(args.answersForSave[0] ?? { prompt: "", response: "" }),
    insightSlotComplete(args.answersForSave[1] ?? { prompt: "", response: "" }),
    insightSlotComplete(args.answersForSave[2] ?? { prompt: "", response: "" }),
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
  const brandsOk = toDisplayOk(args.styleItems.find((i) => i.id === "brands")?.value ?? "");
  const styleOk = toDisplayOk(args.styleItems.find((i) => i.id === "style")?.value ?? "");
  const prefsOk = SCORE_PREF_SECTIONS.map((section) => toDisplayOk(args.preferenceItems.find((i) => i.id === section)?.value ?? ""));
  return computeProfileCompletionPercent({
    hasProfilePhoto,
    looks,
    insights,
    firstNameOk,
    ageOk,
    locationOk,
    workOk,
    sizesOk,
    reseauxOk,
    brandsOk,
    styleOk,
    prefsOk,
  });
}

/** Résumé court pour la carte profil (null si aucun réseau). */
export function formatReseauxSummaryOrNull(profileData: Record<string, unknown>): string | null {
  const s = formatReseauxSummary(profileData);
  return s === "Non renseigné" ? null : s;
}
