"use client";

import { Montserrat } from "next/font/google";
import { GripVertical, Image as ImageIcon, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, TouchEvent } from "react";

import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fileToDataUrl, readPhotoModifyDraft, removePhotoModifyDraft, savePhotoModifyDraft } from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const montserratItalic = Montserrat({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
});

const montserratExtraBoldItalic = Montserrat({
  subsets: ["latin"],
  weight: "700",
  style: "italic",
});

type AnswerSlotProps = {
  prompt: string;
  response: string;
  placeholder: string;
  onChangeResponse: (value: string) => void;
  onOpenPrompt: () => void;
  onClearPrompt: () => void;
  canClearPrompt?: boolean;
  hasError?: boolean;
};

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

type InstagramMediaPreview = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
};

type InstagramStatusResponse = {
  connected: boolean;
  username?: string | null;
  accountType?: string | null;
  mediaCount?: number | null;
  tokenExpiresAt?: string | null;
  syncedAt?: string | null;
  media?: InstagramMediaPreview[];
  warning?: string;
};

const LOOK_STAGE_RATIO = 1;
const MODIFY_CACHE_KEY = "segna:profile-complete:modify-cache:v1";

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
        : true;
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

function toDisplayValue(value: unknown, fallback = "À compléter") {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
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
        aspect: "square",
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

function resolveInsightPickerSlot(requestedSlot: 0 | 1 | 2, slots: ModifyInsightSlot[]): 0 | 1 | 2 {
  const requested = slots[requestedSlot];
  const requestedHasContent = requested.prompt.trim().length > 0 || requested.response.trim().length > 0;
  if (requestedHasContent) return requestedSlot;
  const firstEmptyIndex = slots.findIndex((slot) => slot.prompt.trim().length === 0 && slot.response.trim().length === 0);
  if (firstEmptyIndex === -1) return requestedSlot;
  return (Math.max(0, Math.min(2, firstEmptyIndex)) as 0 | 1 | 2);
}

function AnswerSlot({
  prompt,
  response,
  placeholder,
  onChangeResponse,
  onOpenPrompt,
  onClearPrompt,
  canClearPrompt = false,
  hasError = false,
}: AnswerSlotProps) {
  const hasPrompt = prompt.trim().length > 0;
  const [supportsHover, setSupportsHover] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(hover: hover)");
    const update = () => setSupportsHover(mediaQuery.matches);
    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  const showClearButton = canClearPrompt && (!supportsHover || isHovered);

  return (
    <div
      className={cn("group relative w-full rounded-[11px] border-2 border-dashed bg-transparent px-4 pb-2 pt-2 text-left", hasError ? "border-[#d56a61]" : "border-[#c6c6c6]")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsHovered(true)}
      onBlurCapture={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={onOpenPrompt}
        className={cn(
          montserratExtraBoldItalic.className,
          "min-h-[34px] w-full bg-transparent pr-10 text-left text-[20px] font-extrabold italic leading-[1.08] tracking-[0.01em] text-zinc-900 outline-none",
        )}
      >
        {hasPrompt ? prompt : <span className="text-zinc-500">Choisis une question</span>}
      </button>
      <textarea
        value={response}
        onChange={(event) => onChangeResponse(event.target.value)}
        rows={2}
        placeholder={hasPrompt ? placeholder : "Choisis d'abord une question"}
        disabled={!hasPrompt}
        className={cn(
          montserratItalic.className,
          "mt-1 min-h-[34px] w-full resize-none bg-transparent pr-10 text-[18px] italic leading-[1.08] tracking-[0.01em] text-zinc-900 outline-none placeholder:text-[#c2c2c2] disabled:cursor-not-allowed disabled:text-zinc-400",
        )}
      />
      <button
        type="button"
        onClick={onOpenPrompt}
        className="absolute right-[7px] top-[7px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#5E3023] text-white"
        aria-label="Choisir un prompt"
      >
        <Plus size={16} strokeWidth={3} />
      </button>
      {canClearPrompt ? (
        <button
          type="button"
          onClick={onClearPrompt}
          className={cn(
            "absolute -left-[7px] -top-[7px] inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 transition-opacity",
            showClearButton ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
          aria-label="Supprimer la question"
        >
          <X size={11} strokeWidth={2.8} />
        </button>
      ) : null}
    </div>
  );
}

type ProfileCompleteModifyCoreProps = {
  onInsightsValidityChange?: (isComplete: boolean) => void;
  showInsightsValidationError?: boolean;
  onScorePreviewChange?: React.Dispatch<React.SetStateAction<number | null>>;
};

export function ProfileCompleteModifyCore({ onInsightsValidityChange, showInsightsValidationError = false, onScorePreviewChange }: ProfileCompleteModifyCoreProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);

  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const looksInputRef = useRef<HTMLInputElement | null>(null);
  const activeLookSlotRef = useRef<number>(0);
  const processedModifyIdRef = useRef<string | null>(null);
  const lastSavedAnswersRef = useRef<string>("");
  const [cacheBootstrapDone, setCacheBootstrapDone] = useState(false);
  const [hasCachedBootstrap, setHasCachedBootstrap] = useState(false);

  const [isHydrating, setIsHydrating] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingAnswers, setIsSavingAnswers] = useState(false);

  const [profilePhoto, setProfilePhoto] = useState<LookSlot | null>(null);
  const [looksSlots, setLooksSlots] = useState<Array<LookSlot | null>>([null, null, null]);

  const [prompt0, setPrompt0] = useState("");
  const [prompt1, setPrompt1] = useState("");
  const [prompt2, setPrompt2] = useState("");
  const [response0, setResponse0] = useState("");
  const [response1, setResponse1] = useState("");
  const [response2, setResponse2] = useState("");
  const [infoItems, setInfoItems] = useState<ProfileRowItem[]>([]);
  const [styleItems, setStyleItems] = useState<ProfileRowItem[]>([]);
  const [preferenceItems, setPreferenceItems] = useState<ProfileRowItem[]>([]);
  const [infoVisibilityMap, setInfoVisibilityMap] = useState<Record<string, boolean>>({});
  const [instagramStatus, setInstagramStatus] = useState<InstagramStatusResponse>({ connected: false });
  const [isInstagramLoading, setIsInstagramLoading] = useState(true);
  const [isDisconnectingInstagram, setIsDisconnectingInstagram] = useState(false);
  const [instagramNotice, setInstagramNotice] = useState<string | null>(null);
  const [supportsHover, setSupportsHover] = useState(true);
  const [hoveredLookIndex, setHoveredLookIndex] = useState<number | null>(null);
  const [draggingLookIndex, setDraggingLookIndex] = useState<number | null>(null);
  const [dragOverLookIndex, setDragOverLookIndex] = useState<number | null>(null);
  const [dragLookPreview, setDragLookPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const longPressLookTimerRef = useRef<number | null>(null);
  const touchStartLookRef = useRef<{ x: number; y: number; index: number } | null>(null);
  const suppressNextClickLookRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(hover: hover)");
    const update = () => setSupportsHover(mediaQuery.matches);
    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

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
    if (!options?.silent) setIsHydrating(true);
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
    setLooksSlots(hydratedLooks);

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
    const usersRow = (usersResponse.data ?? {}) as Record<string, unknown>;
    const firstNameValue = toDisplayValue(
      typeof usersRow.first_name === "string" && usersRow.first_name.trim().length > 0 ? usersRow.first_name : profileRow.display_name,
    );
    const infoVisibilityRaw = (profileData.info_visibility ?? {}) as Record<string, unknown>;
    const nextInfoVisibilityMap: Record<string, boolean> = {
      age: typeof infoVisibilityRaw.age === "boolean" ? infoVisibilityRaw.age : true,
      location: typeof infoVisibilityRaw.location === "boolean" ? infoVisibilityRaw.location : true,
      work: typeof infoVisibilityRaw.work === "boolean" ? infoVisibilityRaw.work : true,
      sizes: typeof infoVisibilityRaw.sizes === "boolean" ? infoVisibilityRaw.sizes : true,
    };
    setInfoVisibilityMap(nextInfoVisibilityMap);

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
        label: "Position",
        value: toDisplayValue(profileRow.city ?? (profileData.location as Record<string, unknown> | undefined)?.label),
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
      const isVisible = prefEntry.visible;
      return {
        id: section,
        label: HINGE_PREF_LABELS[section],
        value: toPreferenceDisplay(prefEntry.value, prefEntry.customText),
        visibility: isVisible ? "visible" : "hidden",
        visibilityMode: "preference",
        visibilitySection: section,
      };
    });
    setPreferenceItems(prefRows);

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
    void hydrateFromDatabase({ silent: hasCachedBootstrap });
  }, [cacheBootstrapDone, hasCachedBootstrap, hydrateFromDatabase]);

  const loadInstagramStatus = useCallback(async () => {
    setIsInstagramLoading(true);
    try {
      const response = await fetch("/api/social/instagram/status", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        setInstagramStatus({ connected: false });
        return;
      }
      const payload = (await response.json()) as InstagramStatusResponse;
      setInstagramStatus({
        connected: payload.connected === true,
        username: payload.username ?? null,
        accountType: payload.accountType ?? null,
        mediaCount: typeof payload.mediaCount === "number" ? payload.mediaCount : null,
        tokenExpiresAt: payload.tokenExpiresAt ?? null,
        syncedAt: payload.syncedAt ?? null,
        media: Array.isArray(payload.media) ? payload.media : [],
        warning: payload.warning,
      });
    } catch {
      setInstagramStatus({ connected: false });
    } finally {
      setIsInstagramLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstagramStatus();
  }, [loadInstagramStatus]);

  useEffect(() => {
    const instagramParam = searchParams.get("instagram");
    if (!instagramParam) return;

    if (instagramParam === "connected") {
      setInstagramNotice("Instagram connecte avec succes.");
      void loadInstagramStatus();
      return;
    }
    if (instagramParam === "oauth_state_error") {
      setInstagramNotice("Echec de connexion Instagram (session OAuth invalide). Reessaye.");
      return;
    }
    if (instagramParam === "save_error") {
      setInstagramNotice("Connexion Instagram validee, mais la sauvegarde a echoue. Reessaye.");
      return;
    }
    if (instagramParam === "oauth_error") {
      setInstagramNotice("Instagram a retourne une erreur pendant la connexion.");
      return;
    }
    if (instagramParam === "error") {
      const reason = searchParams.get("reason");
      if (reason === "config") {
        setInstagramNotice("Configuration Instagram manquante: ajoute INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET et le redirect URI.");
      } else {
        setInstagramNotice("Impossible de demarrer la connexion Instagram.");
      }
    }
  }, [loadInstagramStatus, searchParams]);

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
      originalStoragePath?: string;
      offset: { x: number; y: number };
      zoom: number;
    }) => {
      const draftId = crypto.randomUUID();
      try {
        savePhotoModifyDraft({
          id: draftId,
          source: draftPayload.source,
          returnPath: `${pathname}${searchParams.get("tab") ? `?tab=${encodeURIComponent(searchParams.get("tab") as string)}` : ""}`,
          dataUrl: draftPayload.dataUrl,
          originalStoragePath: draftPayload.originalStoragePath,
          fileName: draftPayload.fileName,
          mimeType: draftPayload.mimeType,
          slot: draftPayload.slot,
          aspect: "square",
          offset: draftPayload.offset,
          zoom: draftPayload.zoom,
          status: "pending",
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
    const dataUrl = await fileToDataUrl(file);
    openModifyPage({
      source: "profile",
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      dataUrl,
      originalStoragePath: profilePhoto?.storagePath,
      offset: { x: 0, y: 0 },
      zoom: 1,
    });
  };

  const onPickLookPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Le fichier doit être une image.");
      return;
    }
    const slot = activeLookSlotRef.current;
    const dataUrl = await fileToDataUrl(file);
    openModifyPage({
      source: "looks",
      slot,
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      dataUrl,
      originalStoragePath: looksSlots[slot]?.storagePath,
      offset: { x: 0, y: 0 },
      zoom: 1,
    });
  };

  const setInsightStateFromSlots = useCallback((slots: ModifyInsightSlot[]) => {
    const [s0, s1, s2] = compactInsightSlots(slots);
    setPrompt0(s0.prompt);
    setResponse0(s0.response);
    setPrompt1(s1.prompt);
    setResponse1(s1.response);
    setPrompt2(s2.prompt);
    setResponse2(s2.response);
  }, []);

  const clearInsightSlot = useCallback(
    (slotIndex: number) => {
      const safeSlot = Math.max(0, Math.min(2, slotIndex));
      const current: ModifyInsightSlot[] = [
        { prompt: prompt0, response: response0 },
        { prompt: prompt1, response: response1 },
        { prompt: prompt2, response: response2 },
      ];
      current[safeSlot] = { prompt: "", response: "" };
      setInsightStateFromSlots(current);
    },
    [prompt0, prompt1, prompt2, response0, response1, response2, setInsightStateFromSlots],
  );

  const clearLookSlot = useCallback(
    async (slotIndex: number) => {
      const safeSlot = Math.max(0, Math.min(2, slotIndex));
      const previousLooks = [...looksSlots];
      const nextLooks = [...previousLooks];
      nextLooks[safeSlot] = null;
      const compactedLooks = compactLooksSlots(nextLooks);
      setLooksSlots(compactedLooks);
      setErrorMessage(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        setErrorMessage("Session invalide.");
        setLooksSlots(previousLooks);
        return;
      }

      const { error } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          looks: buildLooksPayload(compactedLooks),
        },
        p_request_id: crypto.randomUUID(),
      });

      if (error) {
        setErrorMessage(error.message);
        setLooksSlots(previousLooks);
      }
    },
    [looksSlots, supabase],
  );

  const moveLookSlot = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setLooksSlots((prev) => {
      const next = [...prev];
      const temp = next[toIndex];
      next[toIndex] = next[fromIndex];
      next[fromIndex] = temp;
      return next;
    });
  }, []);

  const onDropLookSlot = useCallback(
    (dropIndex: number) => {
      if (draggingLookIndex !== null) {
        moveLookSlot(draggingLookIndex, dropIndex);
      }
      setDraggingLookIndex(null);
      setDragOverLookIndex(null);
    },
    [draggingLookIndex, moveLookSlot],
  );

  const onTouchMoveLookSlot = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    if (draggingLookIndex === null) return;
    setDragLookPreview((prev) => (prev ? { ...prev, x: touch.clientX, y: touch.clientY } : prev));
    const hovered = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-look-slot-index]");
    const rawIndex = hovered?.getAttribute("data-look-slot-index");
    const nextIndex = rawIndex ? Number(rawIndex) : null;
    setDragOverLookIndex(Number.isInteger(nextIndex) ? (nextIndex as number) : null);
  }, [draggingLookIndex]);

  const onTouchEndLookSlot = useCallback(() => {
    if (longPressLookTimerRef.current !== null) {
      window.clearTimeout(longPressLookTimerRef.current);
      longPressLookTimerRef.current = null;
    }
    touchStartLookRef.current = null;
    if (draggingLookIndex !== null && dragOverLookIndex !== null) {
      moveLookSlot(draggingLookIndex, dragOverLookIndex);
    }
    if (draggingLookIndex !== null) {
      suppressNextClickLookRef.current = true;
    }
    setDraggingLookIndex(null);
    setDragOverLookIndex(null);
    setDragLookPreview(null);
  }, [draggingLookIndex, dragOverLookIndex, moveLookSlot]);

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
          setErrorMessage(error.message);
        } else {
          const imageRatio = await getImageRatio(draft.dataUrl);
          setProfilePhoto((previous) => ({
            dataUrl: draft.dataUrl,
            fileName: draft.fileName,
            mimeType: draft.mimeType,
            storagePath: draft.originalStoragePath ?? previous?.storagePath,
            imageRatio,
            offset: { x: draft.offset.x, y: draft.offset.y },
            zoom: draft.zoom,
          }));
        }
      } else {
        const slot = typeof draft.slot === "number" ? Math.max(0, Math.min(2, draft.slot)) : 0;
        const imageRatio = await getImageRatio(draft.dataUrl);
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();
        if (!currentUser) {
          setErrorMessage("Session invalide.");
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
              aspect: "square",
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
          setErrorMessage(error.message);
        } else {
          // Re-hydrate from DB to keep all look slots in sync.
          await hydrateFromDatabase({ silent: true });
          setLooksSlots((previous) => {
            const next = [...previous];
            next[slot] = {
              dataUrl: draft.dataUrl,
              fileName: draft.fileName,
              mimeType: draft.mimeType,
              storagePath: draft.originalStoragePath,
              imageRatio,
              offset: { x: draft.offset.x, y: draft.offset.y },
              zoom: draft.zoom,
            };
            return compactLooksSlots(next);
          });
        }
      }

      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });
    })();
  }, [hydrateFromDatabase, pathname, profilePhoto?.storagePath, router, searchParams, supabase]);

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

  const handleConnectInstagram = () => {
    const returnPath = `${pathname}${searchParams.get("tab") ? `?tab=${encodeURIComponent(searchParams.get("tab") as string)}` : ""}`;
    window.location.href = `/api/social/instagram/connect?returnPath=${encodeURIComponent(returnPath)}`;
  };

  const handleDisconnectInstagram = async () => {
    setIsDisconnectingInstagram(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/social/instagram/disconnect", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => ({ message: "Impossible de deconnecter Instagram." }))) as { message?: string };
        setErrorMessage(payload.message || "Impossible de deconnecter Instagram.");
      } else {
        setInstagramStatus({ connected: false, media: [] });
      }
    } catch {
      setErrorMessage("Impossible de deconnecter Instagram.");
    } finally {
      setIsDisconnectingInstagram(false);
    }
  };

  const openPromptPicker = (slot: 0 | 1 | 2) => {
    const insightSlots: ModifyInsightSlot[] = [
      { prompt: prompt0, response: response0 },
      { prompt: prompt1, response: response1 },
      { prompt: prompt2, response: response2 },
    ];
    const targetSlot = resolveInsightPickerSlot(slot, insightSlots);
    const params = new URLSearchParams();
    params.set("slot", String(targetSlot));
    params.set("returnPath", `${pathname}${searchParams.get("tab") ? `?tab=${encodeURIComponent(searchParams.get("tab") as string)}` : ""}`);
    if (prompt0.trim()) params.set("p0", prompt0.trim());
    if (prompt1.trim()) params.set("p1", prompt1.trim());
    if (prompt2.trim()) params.set("p2", prompt2.trim());
    if (response0.trim()) params.set("r0", response0.trim());
    if (response1.trim()) params.set("r1", response1.trim());
    if (response2.trim()) params.set("r2", response2.trim());
    router.push(`/profile/insights/prompts?${params.toString()}`);
  };

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

  const currentReturnPath = `${pathname}${searchParams.get("tab") ? `?tab=${encodeURIComponent(searchParams.get("tab") as string)}` : ""}`;
  const getEditPath = (field: string) => `/profile/edit?field=${encodeURIComponent(field)}&returnPath=${encodeURIComponent(currentReturnPath)}`;

  const renderProfileRows = (items: ProfileRowItem[]) => (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center justify-between px-4 py-3",
            index < items.length - 1 ? "border-b border-zinc-200" : "",
          )}
        >
          <button type="button" onClick={() => router.push(getEditPath(item.id))} className="min-w-0 flex-1 text-left">
            <p className="text-[18px] font-semibold leading-none text-zinc-900">{item.label}</p>
            <p className="mt-1 truncate text-[14px] leading-none text-zinc-400">{item.value}</p>
          </button>
          <div className="ml-3 inline-flex items-center gap-2 text-zinc-400">
            {item.visibilityMode !== "locked" ? (
              <VisibilityToggleEye
                visible={item.visibility === "visible"}
                onVisibilityChange={(nextVisible) => {
                  void toggleItemVisibility(item, nextVisible);
                }}
                className="h-6 w-6"
                iconClassName="h-5 w-5 opacity-60 grayscale"
                ariaLabel={`Visibilité ${item.label}`}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-8">
      <input ref={profileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickProfilePhoto} />
      <input ref={looksInputRef} type="file" accept="image/*" className="hidden" onChange={onPickLookPhoto} />

      <section className="space-y-3">
        <p className="text-[18px] font-semibold text-zinc-400">Mes looks</p>
        <div className="grid grid-cols-3 gap-2">
          {looksSlots.map((slot, index) => (
            <button
              key={`look-slot-${index}`}
              data-look-slot-index={index}
              type="button"
              draggable={Boolean(slot)}
              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                setDraggingLookIndex(index);
                if (slot) {
                  setDragLookPreview({ url: slot.dataUrl, x: event.clientX, y: event.clientY });
                }
                if (event.dataTransfer) {
                  const transparentPixel = new Image();
                  transparentPixel.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                  event.dataTransfer.setDragImage(transparentPixel, 0, 0);
                }
              }}
              onDrag={(event: DragEvent<HTMLButtonElement>) => {
                if (!slot) return;
                if (event.clientX === 0 && event.clientY === 0) return;
                setDragLookPreview({ url: slot.dataUrl, x: event.clientX, y: event.clientY });
              }}
              onDragEnd={() => {
                setDraggingLookIndex(null);
                setDragOverLookIndex(null);
                setDragLookPreview(null);
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
              onDragEnter={() => setDragOverLookIndex(index)}
              onDragLeave={() => setDragOverLookIndex((prev) => (prev === index ? null : prev))}
              onDrop={() => onDropLookSlot(index)}
              onTouchStart={(event) => {
                if (slot) {
                  const touch = event.touches[0];
                  if (!touch) return;
                  touchStartLookRef.current = { x: touch.clientX, y: touch.clientY, index };
                  if (longPressLookTimerRef.current !== null) {
                    window.clearTimeout(longPressLookTimerRef.current);
                  }
                  longPressLookTimerRef.current = window.setTimeout(() => {
                    setDraggingLookIndex(index);
                    setDragOverLookIndex(index);
                    setDragLookPreview({ url: slot.dataUrl, x: touch.clientX, y: touch.clientY });
                    longPressLookTimerRef.current = null;
                  }, 220);
                }
              }}
              onTouchMove={onTouchMoveLookSlot}
              onTouchEnd={onTouchEndLookSlot}
              onTouchCancel={onTouchEndLookSlot}
              onClick={() => {
                if (suppressNextClickLookRef.current) {
                  suppressNextClickLookRef.current = false;
                  return;
                }
                if (slot) {
                  openModifyPage({
                    source: "looks",
                    slot: index,
                    fileName: slot.fileName,
                    mimeType: slot.mimeType,
                    dataUrl: slot.dataUrl,
                    originalStoragePath: slot.storagePath,
                    offset: slot.offset,
                    zoom: slot.zoom,
                  });
                  return;
                }
                const firstEmptyIndex = looksSlots.findIndex((candidate) => !candidate);
                activeLookSlotRef.current = firstEmptyIndex === -1 ? index : firstEmptyIndex;
                looksInputRef.current?.click();
              }}
              onMouseEnter={() => setHoveredLookIndex(index)}
              onMouseLeave={() => setHoveredLookIndex((current) => (current === index ? null : current))}
              onFocus={() => setHoveredLookIndex(index)}
              onBlur={() => setHoveredLookIndex((current) => (current === index ? null : current))}
              className={cn(
                "group relative aspect-square overflow-visible rounded-2xl border-2 border-dashed transition",
                "border-[#5E3023]/55 bg-[#f7f3ef]",
                dragOverLookIndex === index ? "border-[#5E3023] bg-[#f3ece5]" : "",
                slot ? "cursor-grab touch-none active:cursor-grabbing" : "",
                draggingLookIndex === index ? "opacity-30" : "",
              )}
            >
              <div className="absolute inset-0 overflow-hidden rounded-[14px]">
                {slot ? (
                  <>
                    <div
                      className="h-full w-full bg-center bg-no-repeat"
                      style={{
                        backgroundColor: "#000000",
                        backgroundImage: `url(${slot.dataUrl})`,
                        backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / LOOK_STAGE_RATIO)) * slot.zoom}%`,
                        backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
                      }}
                    />
                    <span className="pointer-events-none absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/92 text-zinc-600 shadow-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <GripVertical size={13} />
                    </span>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="relative inline-flex items-center justify-center">
                      <ImageIcon size={32} className="text-zinc-400" />
                      <span className="absolute -bottom-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5E3023] text-white">
                        <Plus size={14} strokeWidth={3} />
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {slot ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void clearLookSlot(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    void clearLookSlot(index);
                  }}
                  className={cn(
                    "absolute -left-[7px] -top-[7px] z-20 inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm transition-opacity",
                    !supportsHover || hoveredLookIndex === index ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
                  )}
                  aria-label={`Supprimer le look ${index + 1}`}
                >
                  <X size={11} strokeWidth={2.8} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <p className={cn(montserrat.className, "text-[14px] italic text-zinc-400")}>Fais glisser pour réorganiser</p>
        <p className={cn(montserrat.className, "text-[14px] font-semibold leading-none text-[#5E3023]")}>Ajoute 1 à 3 photos</p>
      </section>

      <section className="space-y-3">
        <p className="text-[18px] font-semibold text-zinc-400">Mes insights</p>
        <div className="space-y-3">
          <AnswerSlot
            prompt={prompt0}
            response={response0}
            placeholder="Partage ton inspi"
            onChangeResponse={setResponse0}
            onOpenPrompt={() => openPromptPicker(0)}
            onClearPrompt={() => clearInsightSlot(0)}
            canClearPrompt={prompt0.trim().length > 0}
            hasError={showInsightsValidationError && (prompt0.trim().length > 0) !== (response0.trim().length > 0)}
          />
          <AnswerSlot
            prompt={prompt1}
            response={response1}
            placeholder="Partage ton style"
            onChangeResponse={setResponse1}
            onOpenPrompt={() => openPromptPicker(1)}
            onClearPrompt={() => clearInsightSlot(1)}
            canClearPrompt={prompt1.trim().length > 0}
            hasError={showInsightsValidationError && (prompt1.trim().length > 0) !== (response1.trim().length > 0)}
          />
          <AnswerSlot
            prompt={prompt2}
            response={response2}
            placeholder="Partage ton univers"
            onChangeResponse={setResponse2}
            onOpenPrompt={() => openPromptPicker(2)}
            onClearPrompt={() => clearInsightSlot(2)}
            canClearPrompt={prompt2.trim().length > 0}
            hasError={showInsightsValidationError && (prompt2.trim().length > 0) !== (response2.trim().length > 0)}
          />
        </div>
        {showInsightsValidationError && !insightsAreComplete ? (
          <p className={cn(montserrat.className, "text-[14px] font-semibold text-[#E44D3E]")}>
            {missingInsightsCount} insight{missingInsightsCount > 1 ? "s" : ""} incomplet{missingInsightsCount > 1 ? "s" : ""}
          </p>
        ) : null}
        {isSavingAnswers ? <p className={cn(montserrat.className, "text-[12px] text-zinc-500")}>Sauvegarde des insights...</p> : null}
      </section>

      <section className="space-y-2">
        <p className="text-[18px] font-semibold text-zinc-400">Mes infos</p>
        {renderProfileRows(infoItems)}
      </section>

      <section className="space-y-2">
        <p className="text-[18px] font-semibold text-zinc-400">Mon style</p>
        {renderProfileRows(styleItems)}
      </section>

      <section className="space-y-2">
        <p className="text-[18px] font-semibold text-zinc-400">Mes préférences</p>
        {renderProfileRows(preferenceItems)}
      </section>

      <section className="space-y-3">
        <p className="text-[18px] font-semibold text-zinc-400">Instagram</p>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          {instagramNotice ? <p className="mb-3 text-xs text-[#E44D3E]">{instagramNotice}</p> : null}
          {isInstagramLoading ? (
            <p className="text-sm text-zinc-500">Chargement du statut Instagram...</p>
          ) : instagramStatus.connected ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-zinc-900">
                    Compte connecte{instagramStatus.username ? ` @${instagramStatus.username}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {typeof instagramStatus.mediaCount === "number" ? `${instagramStatus.mediaCount} posts au total` : "Instagram connecte"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDisconnectInstagram()}
                  disabled={isDisconnectingInstagram}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDisconnectingInstagram ? "Deconnexion..." : "Deconnecter"}
                </button>
              </div>

              {Array.isArray(instagramStatus.media) && instagramStatus.media.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {instagramStatus.media.map((post) => {
                    const previewUrl = post.thumbnail_url || post.media_url || "";
                    if (!previewUrl) {
                      return (
                        <div key={post.id} className="flex aspect-square items-center justify-center rounded-lg bg-zinc-100 text-[10px] text-zinc-500">
                          Aucun visuel
                        </div>
                      );
                    }
                    const postCard = (
                      <img
                        src={previewUrl}
                        alt={post.caption?.trim() ? post.caption.slice(0, 80) : "Apercu post Instagram"}
                        className="h-full w-full rounded-lg object-cover"
                        loading="lazy"
                      />
                    );
                    if (post.permalink) {
                      return (
                        <a key={post.id} href={post.permalink} target="_blank" rel="noreferrer" className="block aspect-square">
                          {postCard}
                        </a>
                      );
                    }
                    return (
                      <div key={post.id} className="aspect-square">
                        {postCard}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Aucun post recent recupere pour le moment.</p>
              )}
              {instagramStatus.warning ? <p className="text-xs text-[#E44D3E]">{instagramStatus.warning}</p> : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">Connecte ton Instagram pour afficher tes derniers posts en previsualisation sur ton profil.</p>
              <button
                type="button"
                onClick={handleConnectInstagram}
                className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                Connecter Instagram
              </button>
            </div>
          )}
      </div>
      </section>

      {isHydrating ? <p className={cn(montserrat.className, "text-[13px] text-zinc-500")}>Chargement du profil...</p> : null}
      {errorMessage ? <p className="text-[14px] text-[#E44D3E]">{errorMessage}</p> : null}
      {dragLookPreview ? (
        <div
          className="pointer-events-none fixed z-[90] h-24 w-24 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/70 shadow-[0_10px_24px_rgba(0,0,0,0.25)]"
          style={{ left: dragLookPreview.x, top: dragLookPreview.y }}
          aria-hidden
        >
          <img src={dragLookPreview.url} alt="" className="h-full w-full object-cover opacity-95" />
        </div>
      ) : null}
    </div>
  );
}
