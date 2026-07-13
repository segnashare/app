"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { fetchMemberInspirations } from "@/lib/community/fetch-related-inspirations";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import type { InspirationFeedCard } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  preparePhotoModifyImage,
  readPhotoModifyDraft,
  removePhotoModifyDraft,
  registerPhotoModifyRuntimeFile,
  savePhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
import { computeProfileCompletionPreviewPercent } from "@/lib/profile/profile-completion-score";
import {
  isValidInstagramHandle,
  normalizeInstagramHandleInput,
  readSocialHandlesFromProfileData,
} from "@/lib/profile/social-handles";
import { createInspirationHref } from "@/lib/community/create-inspiration-href";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type LookSlot = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  storagePath?: string;
  imageRatio: number;
  offset: { x: number; y: number };
  zoom: number;
};

type ProfileRowItem = {
  id: string;
  label: string;
  value: string;
  visibility: "visible" | "hidden";
  visibilityMode?: "locked" | "profileData" | "preference";
  visibilitySection?: VisibilitySectionId;
  visibilityKey?: string;
};

const LOOK_STAGE_RATIO = 3 / 4;
const MODIFY_CACHE_KEY = "segna:profile-complete:modify-cache:v3";
const PROFILE_HEADER_CACHE_KEY = "segna:profile:header:v3";

/** Préserve `tab` et `from=settings` pour les retours depuis /profile/edit, insights, etc. */
function buildProfileCompleteReturnPath(pathname: string, searchParams: { get: (key: string) => string | null }) {
  const q = new URLSearchParams();
  const tab = searchParams.get("tab");
  if (tab) q.set("tab", tab);
  if (searchParams.get("from") === "settings") q.set("from", "settings");
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

type ModifyCachePayload = {
  profilePhoto: LookSlot | null;
  looksSlots: Array<LookSlot | null>;
  answers: {
    prompt0: string;
    prompt1: string;
    prompt2: string;
    response0: string;
    response1: string;
    response2: string;
  };
  infoItems: ProfileRowItem[];
  styleItems: ProfileRowItem[];
  preferenceItems: ProfileRowItem[];
  infoVisibilityMap: Record<string, boolean>;
  savedAt: number;
};

const VISIBILITY_SECTIONS = ["style", "brands", "motivation", "experience", "share", "budget", "dressing", "ethic"] as const;
type VisibilitySectionId = (typeof VISIBILITY_SECTIONS)[number];
const HINGE_PREF_SECTIONS = ["style", "motivation", "experience", "share", "budget", "dressing", "ethic"] as const;
type PreferenceSectionId = (typeof HINGE_PREF_SECTIONS)[number];

const HINGE_PREF_LABELS: Record<PreferenceSectionId, string> = {
  style: "Style",
  motivation: "Motivation",
  experience: "Expérience",
  share: "Partage",
  budget: "Budget",
  dressing: "Dressing",
  ethic: "Éthique",
};

const STYLE_SECTION_LABELS: Record<"brands" | "style", string> = {
  brands: "Marques",
  style: "Style",
};

function getPreferenceEntry(source: Record<string, unknown>, section: string): { value: unknown; customText: unknown } {
  const sectionRaw = source[section];
  if (sectionRaw && typeof sectionRaw === "object") {
    const asRecord = sectionRaw as Record<string, unknown>;
    const nestedPreference = (asRecord.preference ?? null) as Record<string, unknown> | null;
    return {
      value: asRecord.value ?? nestedPreference?.value ?? source[`${section}_value`],
      customText: asRecord.custom_text ?? asRecord.custom ?? nestedPreference?.custom_text ?? nestedPreference?.custom ?? source[`${section}_custom_text`],
    };
  }
  return {
    value: source[`${section}_value`],
    customText: source[`${section}_custom_text`],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getUserPreferenceSection(row: Record<string, unknown>, section: string): { value: unknown; customText: unknown; visible: boolean } {
  const sectionRaw = asRecord(row[section]);
  const preferenceRaw = asRecord(sectionRaw.preference);
  const fallback = getPreferenceEntry(sectionRaw, section);
  const value = preferenceRaw.value ?? fallback.value;
  const customText = preferenceRaw.custom ?? preferenceRaw.custom_text ?? fallback.customText;
  const visible =
    typeof preferenceRaw.visibility === "boolean"
      ? preferenceRaw.visibility
      : typeof sectionRaw.visibility === "boolean"
        ? sectionRaw.visibility
        : false;
  return { value, customText, visible };
}

function readModifyCache(): ModifyCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(MODIFY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModifyCachePayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.looksSlots) || parsed.looksSlots.length !== 3) return null;
    if (!Array.isArray(parsed.infoItems) || !Array.isArray(parsed.styleItems) || !Array.isArray(parsed.preferenceItems)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeModifyCache(payload: ModifyCachePayload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MODIFY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors: cache is best effort.
  }
}

function clearProfileHeaderCache() {
  try {
    window.sessionStorage.removeItem(PROFILE_HEADER_CACHE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function toDisplayValue(value: unknown, fallback = "À compléter") {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function isProfileRequirementValueFilled(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "À compléter" && trimmed !== "Non renseigné";
}

const ESSENTIAL_ONBOARDING_INFO_IDS = ["first_name", "age", "location", "work", "sizes"] as const;

function collectMissingOnboardingRequirementTargets(
  profilePhoto: LookSlot | null,
  infoItems: ProfileRowItem[],
): Set<string> {
  const targets = new Set<string>();
  if (!profilePhoto) {
    targets.add("profile-photo");
  }
  for (const id of ESSENTIAL_ONBOARDING_INFO_IDS) {
    const value = infoItems.find((item) => item.id === id)?.value;
    if (!isProfileRequirementValueFilled(value)) {
      targets.add(`info-${id}`);
    }
  }
  return targets;
}

function toPreferenceDisplay(value: unknown, customText: unknown) {
  const custom = typeof customText === "string" && customText.trim().length > 0 ? customText.trim() : "";
  if (Array.isArray(value)) {
    const labels = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
    const base = labels.join(", ");
    return custom ? (base ? `${base} (${custom})` : custom) : base || "À compléter";
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return custom ? `${value.trim()} (${custom})` : value.trim();
  }
  if (custom) return custom;
  return "À compléter";
}

const clampPercent = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

const getImageRatio = (dataUrl: string) =>
  new Promise<number>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (image.width > 0 && image.height > 0) {
        resolve(image.width / image.height);
        return;
      }
      resolve(1);
    };
    image.onerror = () => resolve(1);
    image.src = dataUrl;
  });

const parsePhotoPath = (row: Record<string, unknown>) => {
  const photos = (row.photos ?? {}) as Record<string, unknown>;
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
  return profilePhotoPathCandidates.find((value) => typeof value === "string" && value.trim().length > 0)?.toString().trim() ?? null;
};

const parsePhotoTransform = (row: Record<string, unknown>) => {
  const photos = (row.photos ?? {}) as Record<string, unknown>;
  const transformRaw = (photos.profile_photo_transform ?? {}) as Record<string, unknown>;
  const offsetRaw = (transformRaw.offset ?? {}) as Record<string, unknown>;
  return {
    offset: {
      x: clampPercent(offsetRaw.x),
      y: clampPercent(offsetRaw.y),
    },
    zoom: (() => {
      const numeric = typeof transformRaw.zoom === "number" ? transformRaw.zoom : Number(transformRaw.zoom);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
    })(),
  };
};

const parseAnswers = (row: Record<string, unknown>) => {
  const source = row.answers ?? ((row.profile_data as Record<string, unknown> | undefined)?.answers ?? []);
  if (!Array.isArray(source)) return [{ prompt: "", response: "" }, { prompt: "", response: "" }, { prompt: "", response: "" }];
  return Array.from({ length: 3 }).map((_, index) => {
    const entry = source[index];
    if (!entry || typeof entry !== "object") return { prompt: "", response: "" };
    const asRecord = entry as Record<string, unknown>;
    return {
      prompt: typeof asRecord.prompt === "string" ? asRecord.prompt : "",
      response: typeof asRecord.response === "string" ? asRecord.response : "",
    };
  });
};

const parseLooksRaw = (row: Record<string, unknown>) => {
  const profileDataLooks = (row.profile_data as Record<string, unknown> | undefined)?.looks;
  const looksRaw = row.looks;
  // Prefer the non-empty source to avoid dropping legacy looks stored in profile_data.looks.
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
};

function buildLooksPayload(slots: Array<LookSlot | null>) {
  return slots.reduce<Record<string, unknown>>((accumulator, slot, index) => {
    if (!slot) return accumulator;
    accumulator[`look${index + 1}`] = {
      url: slot.storagePath ?? null,
      storage_path: slot.storagePath ?? null,
      position: {
        offset: {
          x: slot.offset.x,
          y: slot.offset.y,
        },
        zoom: slot.zoom,
        aspect: "portrait",
      },
    };
    return accumulator;
  }, {});
}

function compactLooksSlots(slots: Array<LookSlot | null>) {
  const filled = slots.filter((slot): slot is LookSlot => Boolean(slot));
  const compacted: Array<LookSlot | null> = [...filled];
  while (compacted.length < 3) compacted.push(null);
  return compacted.slice(0, 3);
}

type ModifyInsightSlot = { prompt: string; response: string };

function compactInsightSlots(slots: ModifyInsightSlot[]) {
  const filled = slots.filter((slot) => slot.prompt.trim().length > 0 || slot.response.trim().length > 0);
  const compacted: ModifyInsightSlot[] = [...filled];
  while (compacted.length < 3) compacted.push({ prompt: "", response: "" });
  return compacted.slice(0, 3);
}

type ProfileCompleteModifyCoreProps = {
  onInsightsValidityChange?: (isComplete: boolean) => void;
  showInsightsValidationError?: boolean;
  onScorePreviewChange?: React.Dispatch<React.SetStateAction<number | null>>;
  onOnboardingProfileRequirementsChange?: (requirements: {
    hasPhoto: boolean;
    hasEssentialInfos: boolean;
  }) => void;
  /** Incrémenté au clic sur « Terminé » quand le profil onboarding n’est pas prêt → secousse des champs manquants. */
  requirementShakeKey?: number;
};

export function ProfileCompleteModifyCore({
  onInsightsValidityChange,
  showInsightsValidationError = false,
  onScorePreviewChange,
  onOnboardingProfileRequirementsChange,
  requirementShakeKey,
}: ProfileCompleteModifyCoreProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);

  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const processedModifyIdRef = useRef<string | null>(null);
  const lastSavedAnswersRef = useRef<string>("");
  const lastSavedFirstNameRef = useRef<string>("");
  const lastSavedWorkRef = useRef<string>("");
  const lastSavedAgeRef = useRef<string>("");
  const lastSavedInstagramRef = useRef<string>("");
  const [cacheBootstrapDone, setCacheBootstrapDone] = useState(false);
  const [hasCachedBootstrap, setHasCachedBootstrap] = useState(false);

  const [isHydrating, setIsHydrating] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingAnswers, setIsSavingAnswers] = useState(false);

  const [profilePhoto, setProfilePhoto] = useState<LookSlot | null>(null);
  const [looksSlots, setLooksSlots] = useState<Array<LookSlot | null>>([null, null, null]);
  const [postedLooks, setPostedLooks] = useState<InspirationFeedCard[]>([]);
  const [isLoadingPostedLooks, setIsLoadingPostedLooks] = useState(true);
  const [shakingTargets, setShakingTargets] = useState<Set<string>>(() => new Set());

  const [inlineFirstName, setInlineFirstName] = useState("");
  const [inlineAge, setInlineAge] = useState("");
  const [inlineWork, setInlineWork] = useState("");
  const [inlineInstagram, setInlineInstagram] = useState("");
  const [instagramError, setInstagramError] = useState<string | null>(null);

  const [prompt0, setPrompt0] = useState("");
  const [prompt1, setPrompt1] = useState("");
  const [prompt2, setPrompt2] = useState("");
  const [response0, setResponse0] = useState("");
  const [response1, setResponse1] = useState("");
  const [response2, setResponse2] = useState("");
  const [infoItems, setInfoItems] = useState<ProfileRowItem[]>([]);
  const [styleItems, setStyleItems] = useState<ProfileRowItem[]>([]);
  const [preferenceItems, setPreferenceItems] = useState<ProfileRowItem[]>([]);
  /** Dernier `profile_data` chargé : pour que le % prévisualisé utilise la même règle « réseaux » que `user_profiles.score`. */
  const [completionPreviewProfileData, setCompletionPreviewProfileData] = useState<Record<string, unknown> | null>(null);
  const [infoVisibilityMap, setInfoVisibilityMap] = useState<Record<string, boolean>>({});

  const resolveStoragePaths = useCallback(
    async (paths: string[]) => {
      const uniquePaths = Array.from(new Set(paths.filter((path) => path.trim().length > 0)));
      const resolved: Record<string, string> = {};
      if (uniquePaths.length === 0) return resolved;

      const bucket = supabase.storage.from("bucket_focus");
      const createSignedUrls = (bucket as { createSignedUrls?: (paths: string[], expiresIn: number) => Promise<{ data?: Array<{ signedUrl?: string }> | null; error?: { message: string } | null }> }).createSignedUrls;
      if (createSignedUrls) {
        try {
          // Keep method bound to bucket instance (Supabase internals rely on `this`).
          const { data, error } = await bucket.createSignedUrls(uniquePaths, 60 * 60 * 24);
          if (!error && Array.isArray(data)) {
            data.forEach((entry, index) => {
              if (entry?.signedUrl) {
                resolved[uniquePaths[index]] = entry.signedUrl;
              }
            });
          }
        } catch {
          // Fallback to public URLs below.
        }
      }

      uniquePaths.forEach((path) => {
        if (resolved[path]) return;
        const { data: publicData } = bucket.getPublicUrl(path);
        resolved[path] = publicData?.publicUrl || path;
      });
      return resolved;
    },
    [supabase],
  );

  const hydrateFromDatabase = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsHydrating(true);
    }
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage("Session invalide.");
      setIsHydrating(false);
      return;
    }

    const { data: row, error } = await supabase.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (error) {
      setErrorMessage(error.message);
      setIsHydrating(false);
      return;
    }

    const profileRow = (row ?? {}) as Record<string, unknown>;
    const profileData = (profileRow.profile_data ?? {}) as Record<string, unknown>;
    setCompletionPreviewProfileData(profileData);
    const profileId = typeof profileRow.id === "string" ? profileRow.id : null;
    const profilePath = parsePhotoPath(profileRow);
    const profileTransform = parsePhotoTransform(profileRow);
    const looksRaw = parseLooksRaw(profileRow);
    const lookPaths = looksRaw
      .map((raw) => {
        if (!raw) return null;
        const storagePathRaw = raw.storage_path ?? raw.url ?? raw.path;
        return typeof storagePathRaw === "string" && storagePathRaw.trim().length > 0 ? storagePathRaw.trim() : null;
      })
      .filter((path): path is string => Boolean(path));
    const [urlByPath, brandsResponse, sizesResponse, usersResponse, userPreferencesPayloadResponse] = await Promise.all([
      resolveStoragePaths([...(profilePath ? [profilePath] : []), ...lookPaths]),
      profileId
        ? supabase.from("user_profile_brands").select("brand_id, rank").eq("user_profile_id", profileId).order("rank", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      profileId
        ? supabase.from("user_profile_sizes").select("category, size_id").eq("user_profile_id", profileId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("users").select("first_name,last_name").eq("id", user.id).maybeSingle(),
      (supabase.rpc as unknown as (fn: string) => Promise<{ data?: Record<string, unknown> | null; error?: { message: string } | null }>)(
        "get_user_preferences_payload",
      ),
    ]);

    const userPreferencesRow = (userPreferencesPayloadResponse?.data ?? {}) as Record<string, unknown>;

    if (profilePath) {
      const url = urlByPath[profilePath] ?? profilePath;
      setProfilePhoto({
        dataUrl: url,
        fileName: "profile-photo.jpg",
        mimeType: "image/jpeg",
        storagePath: profilePath,
        imageRatio: await getImageRatio(url),
        offset: profileTransform.offset,
        zoom: profileTransform.zoom,
      });
    } else {
      setProfilePhoto(null);
    }

    const hydratedLooks = await Promise.all(
      looksRaw.map(async (raw, index) => {
        if (!raw) return null;
        const storagePathRaw = raw.storage_path ?? raw.url ?? raw.path;
        const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim().length > 0 ? storagePathRaw.trim() : null;
        if (!storagePath) return null;
        const positionRaw = (raw.position ?? {}) as Record<string, unknown>;
        const offsetRaw = (positionRaw.offset ?? {}) as Record<string, unknown>;
        const zoomRaw = typeof positionRaw.zoom === "number" ? positionRaw.zoom : Number(positionRaw.zoom);
        const url = urlByPath[storagePath] ?? storagePath;
        return {
          dataUrl: url,
          fileName: `look-${index + 1}.jpg`,
          mimeType: "image/jpeg",
          storagePath,
          imageRatio: await getImageRatio(url),
          offset: {
            x: clampPercent(offsetRaw.x),
            y: clampPercent(offsetRaw.y),
          },
          zoom: Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1,
        } satisfies LookSlot;
      }),
    );
    setLooksSlots(compactLooksSlots(hydratedLooks));

    const answers = parseAnswers(profileRow);
    const hasAnswersInUrl =
      searchParams.get("p0") !== null ||
      searchParams.get("p1") !== null ||
      searchParams.get("p2") !== null ||
      searchParams.get("r0") !== null ||
      searchParams.get("r1") !== null ||
      searchParams.get("r2") !== null;

    // If we just returned from prompt picker with p0/p1/p2 in URL,
    // keep URL-driven values and avoid overwriting them with stale DB payload.
    if (!hasAnswersInUrl) {
      setPrompt0(answers[0]?.prompt ?? "");
      setPrompt1(answers[1]?.prompt ?? "");
      setPrompt2(answers[2]?.prompt ?? "");
      setResponse0(answers[0]?.response ?? "");
      setResponse1(answers[1]?.response ?? "");
      setResponse2(answers[2]?.response ?? "");
      lastSavedAnswersRef.current = JSON.stringify(answers);
    }

    const brandsRows = (brandsResponse.data ?? []) as Array<{ brand_id?: string | null }>;
    const brandIds = Array.from(
      new Set(brandsRows.map((entry) => (typeof entry.brand_id === "string" ? entry.brand_id : "")).filter((id) => id.length > 0)),
    );
    const { data: brandItemsRows } =
      brandIds.length > 0 ? await supabase.from("item_brands").select("id,label").in("id", brandIds) : { data: [] as Array<{ id: string; label: string | null }> };
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

    const sizesRows = (sizesResponse.data ?? []) as Array<{ category?: string | null; size_id?: string | null }>;
    const sizeIds = Array.from(
      new Set(sizesRows.map((entry) => (typeof entry.size_id === "string" ? entry.size_id : "")).filter((id) => id.length > 0)),
    );
    const { data: sizeItemsRows } =
      sizeIds.length > 0
        ? await supabase.from("sizes").select("id,code,label").in("id", sizeIds)
        : { data: [] as Array<{ id: string; code: string | null; label: string | null }> };
    const sizeById = new Map<string, { code: string; label: string }>(
      ((sizeItemsRows ?? []) as Array<{ id?: string | null; code?: string | null; label?: string | null }>)
        .filter((entry): entry is { id: string; code: string | null; label: string | null } => typeof entry.id === "string")
        .map((entry) => [entry.id, { code: entry.code ?? "", label: entry.label ?? "" }]),
    );
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
    const usersRow = (usersResponse.data ?? {}) as Record<string, unknown>;
    const firstNameValue = toDisplayValue(
      typeof usersRow.first_name === "string" && usersRow.first_name.trim().length > 0 ? usersRow.first_name : profileRow.display_name,
    );
    const ageValue = toDisplayValue(profileRow.age);
    const workValue = toDisplayValue(profileData.work);
    const instagramHandle = readSocialHandlesFromProfileData(profileData).instagram;

    setInlineFirstName(firstNameValue === "À compléter" ? "" : firstNameValue);
    setInlineAge(ageValue === "À compléter" ? "" : ageValue);
    setInlineWork(workValue === "À compléter" ? "" : workValue);
    setInlineInstagram(instagramHandle);
    lastSavedFirstNameRef.current = firstNameValue === "À compléter" ? "" : firstNameValue;
    lastSavedWorkRef.current = workValue === "À compléter" ? "" : workValue;
    lastSavedAgeRef.current = ageValue === "À compléter" ? "" : ageValue;
    lastSavedInstagramRef.current = instagramHandle;

    const infoVisibilityRaw = (profileData.info_visibility ?? {}) as Record<string, unknown>;
    const nextInfoVisibilityMap: Record<string, boolean> = {
      age: typeof infoVisibilityRaw.age === "boolean" ? infoVisibilityRaw.age : true,
      location: typeof infoVisibilityRaw.location === "boolean" ? infoVisibilityRaw.location : true,
      work: typeof infoVisibilityRaw.work === "boolean" ? infoVisibilityRaw.work : true,
      sizes: typeof infoVisibilityRaw.sizes === "boolean" ? infoVisibilityRaw.sizes : true,
      reseaux: typeof infoVisibilityRaw.reseaux === "boolean" ? infoVisibilityRaw.reseaux : true,
    };
    setInfoVisibilityMap(nextInfoVisibilityMap);

    const locationData = profileData.location as Record<string, unknown> | undefined;
    const locationExactLabel =
      typeof locationData?.label === "string" && locationData.label.trim().length > 0
        ? locationData.label.trim()
        : null;

    setInfoItems([
      {
        id: "first_name",
        label: "Prénom",
        value: firstNameValue,
        visibility: "visible",
        visibilityMode: "locked",
      },
      {
        id: "age",
        label: "Âge",
        value: toDisplayValue(profileRow.age),
        visibility: nextInfoVisibilityMap.age ? "visible" : "hidden",
        visibilityMode: "profileData",
        visibilityKey: "age",
      },
      {
        id: "location",
        label: "Adresse",
        value: toDisplayValue(locationExactLabel ?? profileRow.city),
        visibility: nextInfoVisibilityMap.location ? "visible" : "hidden",
        visibilityMode: "profileData",
        visibilityKey: "location",
      },
      {
        id: "work",
        label: "Profession",
        value: toDisplayValue(profileData.work),
        visibility: nextInfoVisibilityMap.work ? "visible" : "hidden",
        visibilityMode: "profileData",
        visibilityKey: "work",
      },
      {
        id: "sizes",
        label: "Tailles",
        value: toDisplayValue(sizesValue),
        visibility: nextInfoVisibilityMap.sizes ? "visible" : "hidden",
        visibilityMode: "profileData",
        visibilityKey: "sizes",
      },
    ]);

    setStyleItems(
      (["brands", "style"] as const).map((section) => {
        const prefEntry = getUserPreferenceSection(userPreferencesRow, section);
        const isVisible = prefEntry.visible;
        const value = section === "brands" ? toDisplayValue(brandsValue) : toPreferenceDisplay(prefEntry.value, prefEntry.customText);
        return {
          id: section,
          label: STYLE_SECTION_LABELS[section],
          value,
          visibility: isVisible ? "visible" : "hidden",
          visibilityMode: "preference",
          visibilitySection: section,
        } satisfies ProfileRowItem;
      }),
    );

    const prefRows: ProfileRowItem[] = HINGE_PREF_SECTIONS.map((section) => {
      const prefEntry = getUserPreferenceSection(userPreferencesRow, section);
      return {
        id: section,
        label: HINGE_PREF_LABELS[section],
        value: toPreferenceDisplay(prefEntry.value, prefEntry.customText),
        visibility: "hidden",
        visibilityMode: "preference",
        visibilitySection: section,
      };
    });
    setPreferenceItems(prefRows);

    setIsLoadingPostedLooks(true);
    const memberLooks = await fetchMemberInspirations(supabase, user.id, 50);
    const authorDisplayName =
      firstNameValue && firstNameValue !== "À compléter" ? firstNameValue : undefined;
    const enrichedLooks = memberLooks.map((card) => ({
      ...card,
      author_user_id: card.author_user_id ?? user.id,
      author_display_name:
        card.author_display_name && card.author_display_name !== "Membre Segna"
          ? card.author_display_name
          : authorDisplayName ?? card.author_display_name,
      author_instagram_username: card.author_instagram_username ?? instagramHandle ?? null,
    }));
    const resolvedLooks = await resolveInspirationCardsMediaUrls(supabase, enrichedLooks);
    setPostedLooks(resolvedLooks);
    setIsLoadingPostedLooks(false);

    setIsHydrating(false);
  }, [resolveStoragePaths, searchParams, supabase]);

  useEffect(() => {
    const cache = readModifyCache();
    if (cache) {
      setProfilePhoto(cache.profilePhoto);
      setLooksSlots(cache.looksSlots);
      setInfoItems(cache.infoItems);
      setStyleItems(cache.styleItems);
      setPreferenceItems(cache.preferenceItems);
      setInfoVisibilityMap(cache.infoVisibilityMap ?? {});
      setPrompt0(cache.answers.prompt0);
      setPrompt1(cache.answers.prompt1);
      setPrompt2(cache.answers.prompt2);
      setResponse0(cache.answers.response0);
      setResponse1(cache.answers.response1);
      setResponse2(cache.answers.response2);
      lastSavedAnswersRef.current = JSON.stringify([
        { prompt: cache.answers.prompt0.trim(), response: cache.answers.response0.trim() },
        { prompt: cache.answers.prompt1.trim(), response: cache.answers.response1.trim() },
        { prompt: cache.answers.prompt2.trim(), response: cache.answers.response2.trim() },
      ]);
      setHasCachedBootstrap(true);
      setIsHydrating(false);
    } else {
      setHasCachedBootstrap(false);
    }
    setCacheBootstrapDone(true);
  }, []);

  useEffect(() => {
    if (!cacheBootstrapDone) return;
    if (searchParams.get("photoModifyId")) return;
    void hydrateFromDatabase({ silent: hasCachedBootstrap });
  }, [cacheBootstrapDone, hasCachedBootstrap, hydrateFromDatabase, searchParams]);

  useEffect(() => {
    const p0 = searchParams.get("p0");
    const p1 = searchParams.get("p1");
    const p2 = searchParams.get("p2");
    const r0 = searchParams.get("r0");
    const r1 = searchParams.get("r1");
    const r2 = searchParams.get("r2");
    const hasAnswerParams = p0 !== null || p1 !== null || p2 !== null || r0 !== null || r1 !== null || r2 !== null;
    if (!hasAnswerParams) return;
    setPrompt0(p0 ?? "");
    setPrompt1(p1 ?? "");
    setPrompt2(p2 ?? "");
    setResponse0(r0 ?? "");
    setResponse1(r1 ?? "");
    setResponse2(r2 ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (isHydrating) return;
    writeModifyCache({
      profilePhoto,
      looksSlots,
      infoItems,
      styleItems,
      preferenceItems,
      infoVisibilityMap,
      answers: {
        prompt0,
        prompt1,
        prompt2,
        response0,
        response1,
        response2,
      },
      savedAt: Date.now(),
    });
  }, [infoItems, infoVisibilityMap, isHydrating, looksSlots, preferenceItems, profilePhoto, prompt0, prompt1, prompt2, response0, response1, response2, styleItems]);

  const openModifyPage = useCallback(
    (draftPayload: {
      source: "profile" | "looks";
      slot?: number;
      fileName: string;
      mimeType: string;
      dataUrl: string;
      file?: File;
      originalStoragePath?: string;
      offset: { x: number; y: number };
      zoom: number;
      isRemoteSource?: boolean;
    }) => {
      const draftId = crypto.randomUUID();
      try {
        if (draftPayload.file) {
          registerPhotoModifyRuntimeFile(draftId, draftPayload.file, draftPayload.dataUrl);
        }
        savePhotoModifyDraft({
          id: draftId,
          source: draftPayload.source,
          returnPath: `${pathname}${searchParams.get("tab") ? `?tab=${encodeURIComponent(searchParams.get("tab") as string)}` : ""}`,
          dataUrl: draftPayload.dataUrl,
          originalStoragePath: draftPayload.originalStoragePath,
          fileName: draftPayload.fileName,
          mimeType: draftPayload.mimeType,
          slot: draftPayload.slot,
          aspect: draftPayload.source === "looks" ? "portrait" : "square",
          offset: draftPayload.offset,
          zoom: draftPayload.zoom,
          status: "pending",
          isRemoteSource: draftPayload.isRemoteSource ?? !draftPayload.file,
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Impossible de préparer la photo.");
        return;
      }
      router.push(`/modify?id=${encodeURIComponent(draftId)}`);
    },
    [pathname, router, searchParams],
  );

  const onPickProfilePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Le fichier doit être une image.");
      return;
    }
    setErrorMessage(null);
    const prepared = await preparePhotoModifyImage(file);
    openModifyPage({
      source: "profile",
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      dataUrl: prepared.previewUrl,
      file: prepared.file,
      originalStoragePath: profilePhoto?.storagePath,
      offset: { x: 0, y: 0 },
      zoom: 1,
      isRemoteSource: false,
    });
  };

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId || processedModifyIdRef.current === modifiedId) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || (draft.source !== "profile" && draft.source !== "looks")) return;
    if (draft.status !== "confirmed" && draft.status !== "cancelled") return;

    processedModifyIdRef.current = modifiedId;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;

    if (draft.status === "cancelled") {
      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });
      return;
    }

    void (async () => {
      setErrorMessage(null);
      if (draft.source === "profile") {
        const imageRatio = await getImageRatio(draft.dataUrl);
        const previousProfilePhoto = profilePhoto;
        const nextProfilePhoto: LookSlot = {
          dataUrl: draft.dataUrl,
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          storagePath: draft.originalStoragePath ?? profilePhoto?.storagePath,
          imageRatio,
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        };
        setProfilePhoto(nextProfilePhoto);

        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            photos: {
              profile_photo_selected: true,
              profile_photo_name: draft.fileName,
              profile_photo_path: draft.originalStoragePath ?? profilePhoto?.storagePath ?? null,
              profile_photo_transform: {
                offset: { x: draft.offset.x, y: draft.offset.y },
                zoom: draft.zoom,
                aspect: "square",
              },
            },
          },
          p_request_id: crypto.randomUUID(),
        });
        if (error) {
          setProfilePhoto(previousProfilePhoto);
          setErrorMessage(error.message);
        } else {
          clearProfileHeaderCache();
        }
      } else {
        const slot = typeof draft.slot === "number" ? Math.max(0, Math.min(2, draft.slot)) : 0;
        const imageRatio = await getImageRatio(draft.dataUrl);
        const previousLooks = looksSlots;
        const nextLookSlot: LookSlot = {
          dataUrl: draft.dataUrl,
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          storagePath: draft.originalStoragePath,
          imageRatio,
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        };
        if (draft.originalStoragePath) {
          setLooksSlots((previous) => {
            const next = [...previous];
            next[slot] = nextLookSlot;
            return compactLooksSlots(next);
          });
        }
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();
        if (!currentUser) {
          setErrorMessage("Session invalide.");
          setLooksSlots(previousLooks);
          removePhotoModifyDraft(modifiedId);
          router.replace(nextUrl, { scroll: false });
          return;
        }

        const { data: latestProfileRow } = await supabase
          .from("user_profiles")
          .select("looks, profile_data")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        const latestLooksRaw = parseLooksRaw((latestProfileRow ?? {}) as Record<string, unknown>);
        const mergedLooksPayload = latestLooksRaw.reduce<Record<string, unknown>>((accumulator, raw, index) => {
          if (!raw) return accumulator;
          accumulator[`look${index + 1}`] = raw;
          return accumulator;
        }, {});

        if (draft.originalStoragePath) {
          mergedLooksPayload[`look${slot + 1}`] = {
            url: draft.originalStoragePath,
            storage_path: draft.originalStoragePath,
            position: {
              offset: { x: draft.offset.x, y: draft.offset.y },
              zoom: draft.zoom,
              aspect: "portrait",
            },
          };
        } else {
          setErrorMessage("Chemin de stockage look manquant.");
          removePhotoModifyDraft(modifiedId);
          router.replace(nextUrl, { scroll: false });
          return;
        }

        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            looks: mergedLooksPayload,
          },
          p_request_id: crypto.randomUUID(),
        });
        if (error) {
          setLooksSlots(previousLooks);
          setErrorMessage(error.message);
        } else {
          clearProfileHeaderCache();
        }
      }

      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });
    })();
  }, [looksSlots, pathname, profilePhoto, router, searchParams, supabase]);

  const answersForSave = useMemo(
    () => [
      { prompt: prompt0.trim(), response: response0.trim() },
      { prompt: prompt1.trim(), response: response1.trim() },
      { prompt: prompt2.trim(), response: response2.trim() },
    ],
    [prompt0, prompt1, prompt2, response0, response1, response2],
  );
  const missingInsightsCount = useMemo(
    () =>
      answersForSave.filter((item) => {
        const hasPrompt = item.prompt.length > 0;
        const hasResponse = item.response.length > 0;
        return hasPrompt !== hasResponse;
      }).length,
    [answersForSave],
  );
  const insightsAreComplete = useMemo(
    () =>
      answersForSave.every((item) => {
        const hasPrompt = item.prompt.length > 0;
        const hasResponse = item.response.length > 0;
        return (hasPrompt && hasResponse) || (!hasPrompt && !hasResponse);
      }),
    [answersForSave],
  );

  useEffect(() => {
    onInsightsValidityChange?.(insightsAreComplete);
  }, [insightsAreComplete, onInsightsValidityChange]);

  useEffect(() => {
    if (!onScorePreviewChange || isHydrating) return;
    const pct = computeProfileCompletionPreviewPercent({
      looksSlots,
      infoItems: infoItems.map((i) => ({ id: i.id, value: i.value })),
      reseauxProfileData: completionPreviewProfileData,
    });
    onScorePreviewChange(pct);
  }, [onScorePreviewChange, isHydrating, looksSlots, infoItems, completionPreviewProfileData]);

  useEffect(() => {
    if (!onOnboardingProfileRequirementsChange || isHydrating) return;
    const getInfo = (id: string) => infoItems.find((item) => item.id === id)?.value ?? "";
    onOnboardingProfileRequirementsChange({
      hasPhoto: Boolean(profilePhoto),
      hasEssentialInfos:
        isProfileRequirementValueFilled(getInfo("first_name")) &&
        isProfileRequirementValueFilled(getInfo("age")) &&
        isProfileRequirementValueFilled(getInfo("location")) &&
        isProfileRequirementValueFilled(getInfo("work")) &&
        isProfileRequirementValueFilled(getInfo("sizes")),
    });
  }, [infoItems, isHydrating, profilePhoto, onOnboardingProfileRequirementsChange]);

  useEffect(() => {
    if (requirementShakeKey == null || requirementShakeKey === 0 || isHydrating) return;
    const targets = collectMissingOnboardingRequirementTargets(profilePhoto, infoItems);
    if (targets.size === 0) return;
    setShakingTargets(targets);
    const scrollTargetId = targets.has("profile-photo") ? "profile-photo" : [...targets][0];
    requestAnimationFrame(() => {
      document.querySelector(`[data-profile-shake="${scrollTargetId}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const timeoutId = window.setTimeout(() => setShakingTargets(new Set()), 560);
    return () => window.clearTimeout(timeoutId);
  }, [requirementShakeKey, isHydrating, profilePhoto, infoItems]);

  useEffect(() => {
    if (isHydrating) return;
    const serialized = JSON.stringify(answersForSave);
    if (serialized === lastSavedAnswersRef.current) return;

    const timeout = window.setTimeout(() => {
      void (async () => {
        setIsSavingAnswers(true);
        const payload = answersForSave.filter((item) => item.prompt.length > 0 || item.response.length > 0);
        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            answers: payload,
          },
          p_request_id: crypto.randomUUID(),
        });
        setIsSavingAnswers(false);
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        lastSavedAnswersRef.current = serialized;
      })();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [answersForSave, isHydrating, supabase]);

  const syncPreferenceVisibility = (section: VisibilitySectionId, isVisible: boolean) => {
    setStyleItems((previous) => previous.map((item) => (item.visibilitySection === section ? { ...item, visibility: isVisible ? "visible" : "hidden" } : item)));
    setPreferenceItems((previous) => previous.map((item) => (item.visibilitySection === section ? { ...item, visibility: isVisible ? "visible" : "hidden" } : item)));
  };

  const toggleItemVisibility = async (item: ProfileRowItem, explicitVisible?: boolean) => {
    const nextVisible = typeof explicitVisible === "boolean" ? explicitVisible : item.visibility !== "visible";
    if (item.visibilityMode === "locked") return;

    if (item.visibilityMode === "preference" && item.visibilitySection) {
      syncPreferenceVisibility(item.visibilitySection, nextVisible);
      const { error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error?: { message: string } | null }>)("set_profile_preference_visibility", {
        p_section: item.visibilitySection,
        p_visible: nextVisible,
        p_request_id: crypto.randomUUID(),
      });
      if (error) {
        syncPreferenceVisibility(item.visibilitySection, !nextVisible);
        setErrorMessage(error.message ?? "Impossible de mettre à jour la visibilité.");
      }
      return;
    }

    if (item.visibilityMode === "profileData" && item.visibilityKey) {
      const rollbackMap = { ...infoVisibilityMap };
      const nextMap = { ...infoVisibilityMap, [item.visibilityKey]: nextVisible };
      setInfoVisibilityMap(nextMap);
      setInfoItems((previous) => previous.map((current) => (current.id === item.id ? { ...current, visibility: nextVisible ? "visible" : "hidden" } : current)));
      const { error } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            info_visibility: nextMap,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (error) {
        setInfoVisibilityMap(rollbackMap);
        setInfoItems((previous) => previous.map((current) => (current.id === item.id ? { ...current, visibility: item.visibility } : current)));
        setErrorMessage(error.message);
      }
    }
  };

  const currentReturnPath = buildProfileCompleteReturnPath(pathname, searchParams);
  const getEditPath = (field: string) => `/profile/edit?field=${encodeURIComponent(field)}&returnPath=${encodeURIComponent(currentReturnPath)}`;

  const syncInfoItemValue = useCallback((id: string, value: string) => {
    setInfoItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, value: value.trim().length > 0 ? value.trim() : "À compléter" } : item)),
    );
  }, []);

  useEffect(() => {
    if (isHydrating) return;
    const normalized = inlineFirstName.trim();
    if (normalized === lastSavedFirstNameRef.current) return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        if (normalized.length < 2) return;
        const settingsResult = await (supabase.rpc as unknown as (
          fn: string,
          args?: Record<string, unknown>,
        ) => Promise<{ error?: { message?: string } | null }>)("update_user_account_settings", {
          p_locale: null,
          p_timezone: null,
          p_first_name: capitalizeFirstLetter(normalized),
          p_last_name: null,
          p_request_id: crypto.randomUUID(),
        });
        if (settingsResult?.error) {
          setErrorMessage(settingsResult.error.message ?? "Impossible d'enregistrer le prénom.");
          return;
        }
        lastSavedFirstNameRef.current = normalized;
        syncInfoItemValue("first_name", normalized);
        clearProfileHeaderCache();
      })();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [inlineFirstName, isHydrating, supabase, syncInfoItemValue]);

  useEffect(() => {
    if (isHydrating) return;
    const normalized = inlineWork.trim();
    if (normalized === lastSavedWorkRef.current) return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        if (normalized.length < 2) return;
        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: { profile_data: { work: normalized } },
          p_request_id: crypto.randomUUID(),
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        lastSavedWorkRef.current = normalized;
        syncInfoItemValue("work", normalized);
      })();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [inlineWork, isHydrating, supabase, syncInfoItemValue]);

  useEffect(() => {
    if (isHydrating) return;
    const normalized = inlineAge.trim();
    if (normalized === lastSavedAgeRef.current) return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const ageNumber = Number(normalized);
        if (!Number.isFinite(ageNumber) || ageNumber < 16 || ageNumber > 120) return;
        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: { age: ageNumber },
          p_request_id: crypto.randomUUID(),
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        lastSavedAgeRef.current = normalized;
        syncInfoItemValue("age", normalized);
      })();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [inlineAge, isHydrating, supabase, syncInfoItemValue]);

  useEffect(() => {
    if (isHydrating) return;
    const normalized = normalizeInstagramHandleInput(inlineInstagram);
    if (normalized === lastSavedInstagramRef.current) return;
    if (normalized && !isValidInstagramHandle(normalized)) {
      setInstagramError("Pseudo Instagram invalide.");
      return;
    }
    setInstagramError(null);
    const timeout = window.setTimeout(() => {
      void (async () => {
        const { error } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            profile_data: {
              instagram_username: normalized || null,
              tiktok_username: null,
              pinterest_username: null,
              threads_username: null,
            },
          },
          p_request_id: crypto.randomUUID(),
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        lastSavedInstagramRef.current = normalized;
        setCompletionPreviewProfileData((previous) => ({
          ...(previous ?? {}),
          instagram_username: normalized || null,
        }));
        clearProfileHeaderCache();
      })();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [inlineInstagram, isHydrating, supabase]);

  const inlineInfoItems = infoItems.filter((item) => item.id !== "location" && item.id !== "sizes");
  const navigationInfoItems = infoItems.filter((item) => item.id === "location" || item.id === "sizes");

  const infoValueClassName = "text-right text-[15px] text-zinc-600";

  const renderInfoRows = () => (
    <div className={cn(montserrat.className, "divide-y divide-zinc-100")}>
      {inlineInfoItems.map((item) => (
        <div
          key={item.id}
          data-profile-shake={`info-${item.id}`}
          className={cn(
            "flex items-center gap-3 py-3.5",
            shakingTargets.has(`info-${item.id}`) ? "profile-requirement-vibrate" : "",
          )}
        >
          <span className="w-[110px] shrink-0 text-[15px] font-semibold text-zinc-900">{item.label}</span>
          <div className="min-w-0 flex-1">
            {item.id === "first_name" ? (
              <input
                type="text"
                value={inlineFirstName}
                onChange={(event) => setInlineFirstName(event.target.value)}
                placeholder="Prénom"
                className={cn("w-full bg-transparent outline-none placeholder:text-zinc-300", infoValueClassName)}
              />
            ) : item.id === "age" ? (
              <input
                type="text"
                inputMode="numeric"
                value={inlineAge}
                onChange={(event) => setInlineAge(event.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="Âge"
                className={cn("w-full bg-transparent outline-none placeholder:text-zinc-300", infoValueClassName)}
              />
            ) : item.id === "work" ? (
              <input
                type="text"
                value={inlineWork}
                onChange={(event) => setInlineWork(event.target.value)}
                placeholder="Profession"
                className={cn("w-full bg-transparent outline-none placeholder:text-zinc-300", infoValueClassName)}
              />
            ) : (
              <span className={cn("block truncate", infoValueClassName)}>{item.value}</span>
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 py-3.5">
        <span className="w-[110px] shrink-0 text-[15px] font-semibold text-zinc-900">Instagram</span>
        <div className="min-w-0 flex-1">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="ex : segnashare"
            value={inlineInstagram}
            onChange={(event) => {
              setInlineInstagram(event.target.value);
              setInstagramError(null);
            }}
            className={cn("w-full bg-transparent outline-none placeholder:text-zinc-300", infoValueClassName)}
          />
        </div>
      </div>
      {instagramError ? <p className="py-2 text-[13px] text-[#E44D3E]">{instagramError}</p> : null}
      {navigationInfoItems.map((item) => (
        <button
          key={item.id}
          type="button"
          data-profile-shake={`info-${item.id}`}
          onClick={() => router.push(getEditPath(item.id))}
          className={cn(
            "flex w-full items-center gap-3 py-3.5 text-left",
            shakingTargets.has(`info-${item.id}`) ? "profile-requirement-vibrate" : "",
          )}
        >
          <span className="w-[110px] shrink-0 text-[15px] font-semibold text-zinc-900">{item.label}</span>
          <span className={cn("min-w-0 flex-1 truncate", infoValueClassName)}>{item.value}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="-mx-4 flex flex-col space-y-[4.5px] bg-zinc-100">
      <input ref={profileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickProfilePhoto} />

      <section
        data-profile-shake="profile-photo"
        className={cn(
          "flex flex-col items-center bg-white px-5 py-5",
          shakingTargets.has("profile-photo") ? "profile-requirement-vibrate" : "",
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (profilePhoto) {
              openModifyPage({
                source: "profile",
                fileName: profilePhoto.fileName,
                mimeType: profilePhoto.mimeType,
                dataUrl: profilePhoto.dataUrl,
                originalStoragePath: profilePhoto.storagePath,
                offset: profilePhoto.offset,
                zoom: profilePhoto.zoom,
                isRemoteSource: true,
              });
              return;
            }
            profileInputRef.current?.click();
          }}
          aria-label="Modifier la photo de profil"
          className="relative h-36 w-36 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          {profilePhoto ? (
            <RemoteCoverThumb
              photoUrl={profilePhoto.dataUrl}
              frameClassName="h-full w-full rounded-full"
              coverStyle={{
                backgroundSize: `${Math.max(100, 100 * (profilePhoto.imageRatio / 1)) * profilePhoto.zoom}%`,
                backgroundPosition: `calc(50% + ${profilePhoto.offset.x}%) calc(50% + ${profilePhoto.offset.y}%)`,
                backgroundRepeat: "no-repeat",
              }}
              className="rounded-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-4xl font-semibold text-zinc-500">+</div>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (profilePhoto) {
              openModifyPage({
                source: "profile",
                fileName: profilePhoto.fileName,
                mimeType: profilePhoto.mimeType,
                dataUrl: profilePhoto.dataUrl,
                originalStoragePath: profilePhoto.storagePath,
                offset: profilePhoto.offset,
                zoom: profilePhoto.zoom,
                isRemoteSource: true,
              });
              return;
            }
            profileInputRef.current?.click();
          }}
          className="mt-4 text-[17px] font-semibold text-zinc-900"
        >
          Modifier la photo de profil
        </button>
      </section>

      <section className="bg-white px-5 py-4">
        <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME, "pb-3")}>Infos</h2>
        {renderInfoRows()}
      </section>

      <section className="bg-white px-5 py-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+1rem))]">
        <div className="flex min-h-11 items-center justify-between gap-3 pb-3">
          <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME, "min-w-0")}>Looks</h2>
          <Link
            href={createInspirationHref(currentReturnPath)}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            <span>Nouveau look</span>
          </Link>
        </div>
        {isLoadingPostedLooks ? (
          <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>Chargement des looks...</p>
        ) : postedLooks.length === 0 ? (
          <Link
            href={createInspirationHref(currentReturnPath)}
            aria-label="Ajouter un look"
            className="flex aspect-[3/4] w-full items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 transition hover:border-zinc-400 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <Plus className="h-10 w-10 text-zinc-400" strokeWidth={2} aria-hidden />
          </Link>
        ) : (
          <InspirationMasonryGrid cards={postedLooks} compact likeMode="count" />
        )}
      </section>

      {isHydrating || errorMessage ? (
        <section className="bg-white px-5 py-4">
          {isHydrating ? <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>Chargement du profil...</p> : null}
          {errorMessage ? <p className="text-[14px] text-[#E44D3E]">{errorMessage}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
