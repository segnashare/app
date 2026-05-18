"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CmsFrameItem, CmsLinkCardCtaToneProvider } from "@/components/cms/CmsSectionBlocks";
import { CardBase } from "@/components/layout/CardBase";
import { CommunityBadgesGrid } from "@/components/community/CommunityBadgesGrid";
import { CommunityShareActions } from "@/components/community/CommunityShareActions";
import { GoogleReviewCta } from "@/components/reviews/GoogleReviewCta";
import { TrustpilotReviewCta } from "@/components/reviews/TrustpilotReviewCta";
import { ProfileIdentitySummary } from "@/components/profile/ProfileIdentitySummary";
import { ProfileProgressAvatar } from "@/components/profile/ProfileProgressAvatar";
import { readPhotoModifyDraft, removePhotoModifyDraft, savePhotoModifyDraft } from "@/lib/onboarding/photoModifyStore";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { measureClientPhotoPerf } from "@/lib/perf/client-photo-flow";
import { cn } from "@/lib/utils/cn";
import { persistProfileCompletionScore } from "@/lib/profile/profile-completion-score";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";

const PROFILE_TABS = [
  { id: "plus", label: "Obtenir plus" },
  { id: "me", label: "Mon profil" },
] as const;

/** Coquille commune pour les deux liens d’avis (même hauteur, même style « bouton »). */
const PROFILE_REVIEW_CARD_SHELL =
  "flex h-14 w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white px-1.5 shadow-sm transition hover:border-zinc-300 hover:shadow-md sm:px-2";

type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

type ProfileTabsProps = {
  initialTab?: string;
  initialDisplayName?: string;
  /** CMS — onglet Obtenir plus */
  initialPlusTabCmsFrames?: CmsFrameRow[];
  /** CMS — onglet Mon profil : frames `profile_plus_hero` (page Autre dans le BO), même format que « Obtenir plus ». */
  initialMeTabProfileHeroFrames?: CmsFrameRow[];
  /** CMS — bannière du bloc parrainage (`shop_link_card`, section `profile_referral_banner`, page Autre BO). */
  initialReferralBannerFrames?: CmsFrameRow[];
  /** Code parrainage (table `referrals_codes`) — affiché sous les cartes « Obtenir plus ». */
  initialReferralCode?: string | null;
};

type ProfileHeaderData = {
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

type BadgeProgressItem = {
  badge_code: string;
  label: string;
  description: string | null;
  icon: string | null;
  current_value: number;
  target_value: number;
  is_completed: boolean;
};

type ProfileGamificationData = {
  dayStreak: number;
  totalXp: number;
  currentLevelNo: number;
  currentRank: string;
  nextRank: string | null;
  remainingToNext: number;
  progressPercent: number;
  badges: BadgeProgressItem[];
};

const DEFAULT_HEADER_DATA: ProfileHeaderData = {
  displayName: "Profil",
  completionScore: 0,
  avatarUrl: null,
  profilePhotoPath: null,
  avatarTransform: {
    offset: { x: 0, y: 0 },
    zoom: 1,
  },
  kycStatus: "unknown",
};

const DEFAULT_GAMIFICATION_DATA: ProfileGamificationData = {
  dayStreak: 0,
  totalXp: 0,
  currentLevelNo: 1,
  currentRank: "Nouvelle",
  nextRank: null,
  remainingToNext: 0,
  progressPercent: 0,
  badges: [],
};

/**
 * Streak, confiance et grille de badges (onglet « Obtenir plus »). Les données gamification
 * continuent d’être chargées en arrière-plan ; passer à `true` pour réafficher avant refonte.
 */
const PROFILE_PLUS_SHOW_GAMIFICATION_EXTRAS = false;

const TAB_SET = new Set<ProfileTabId>(PROFILE_TABS.map((tab) => tab.id));
const PROFILE_HEADER_CACHE_KEY = "segna:profile:header:v3";
const PROFILE_HEADER_CACHE_TTL_MS = 10 * 60 * 1000;

function parseProfileTab(value: string | null | undefined): ProfileTabId {
  if (value === "security") return "me";
  return value && TAB_SET.has(value as ProfileTabId) ? (value as ProfileTabId) : "plus";
}

function isProfileCompletionHeroRow(row: CmsFrameRow): boolean {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const haystack = [
    payload.target_url,
    payload.title,
    payload.label,
    payload.subtitle,
    payload.cta_label,
    payload.button_label,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("/profile/complete") || haystack.includes("complète ton profil") || haystack.includes("complete ton profil");
}

function getFirstLookPhotoPath(row: Record<string, unknown> | null | undefined): string | null {
  if (!row || typeof row !== "object") return null;
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

function getProfileHeaderFromRow(row: Record<string, unknown> | null | undefined): Partial<ProfileHeaderData> {
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
  const kycStatus = normalizeKycStatus(rawKyc);
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
    profilePhotoPathCandidates.find((value) => typeof value === "string" && value.trim().length > 0)?.toString().trim() ?? null;
  const fallbackLookPhotoPath = getFirstLookPhotoPath(row);
  const transformRaw = (photos.profile_photo_transform ?? {}) as Record<string, unknown>;
  const offsetRaw = (transformRaw.offset ?? {}) as Record<string, unknown>;
  const zoomRaw = typeof transformRaw.zoom === "number" ? transformRaw.zoom : Number(transformRaw.zoom);
  const avatarTransform = {
    offset: {
      x: typeof offsetRaw.x === "number" ? offsetRaw.x : Number(offsetRaw.x) || 0,
      y: typeof offsetRaw.y === "number" ? offsetRaw.y : Number(offsetRaw.y) || 0,
    },
    zoom: Number.isFinite(zoomRaw) ? zoomRaw : 1,
  };
  return {
    displayName,
    completionScore: Number.isFinite(numericScore) ? numericScore : undefined,
    avatarUrl,
    avatarTransform,
    profilePhotoPath: profilePhotoPath ?? fallbackLookPhotoPath,
    kycStatus,
  };
}

function normalizeKycStatus(rawKyc: unknown): ProfileHeaderData["kycStatus"] {
  const normalizedKyc = typeof rawKyc === "string" ? rawKyc.toLowerCase() : "";
  if (normalizedKyc === "verified" || normalizedKyc === "approved" || normalizedKyc === "validated") return "verified";
  if (normalizedKyc === "pending") return "pending";
  if (normalizedKyc === "rejected") return "rejected";
  return "unknown";
}

function getKycStatusFromVerificationRow(row: Record<string, unknown> | null | undefined): ProfileHeaderData["kycStatus"] {
  if (!row || typeof row !== "object") return "unknown";
  return normalizeKycStatus(row.verification_status ?? row.status);
}

type ProfileHeaderCachePayload = {
  userId: string;
  updatedAt: number;
  headerData: ProfileHeaderData;
};

function readProfileHeaderCachePayload(): ProfileHeaderCachePayload | null {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_HEADER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileHeaderCachePayload;
    if (!parsed) return null;
    if (Date.now() - parsed.updatedAt > PROFILE_HEADER_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readProfileHeaderCache(userId: string): ProfileHeaderData | null {
  const parsed = readProfileHeaderCachePayload();
  if (!parsed || parsed.userId !== userId) return null;
  return parsed.headerData;
}

function readWarmProfileHeaderCache(): ProfileHeaderData | null {
  const parsed = readProfileHeaderCachePayload();
  return parsed?.headerData ?? null;
}

function writeProfileHeaderCache(userId: string, headerData: ProfileHeaderData) {
  try {
    const payload: ProfileHeaderCachePayload = {
      userId,
      updatedAt: Date.now(),
      headerData: {
        ...headerData,
        // Blob URLs are document-scoped and should not be persisted.
        avatarUrl: headerData.avatarUrl?.startsWith("blob:") ? null : headerData.avatarUrl,
      },
    };
    window.sessionStorage.setItem(PROFILE_HEADER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

export function ProfileTabs({
  initialTab,
  initialDisplayName,
  initialPlusTabCmsFrames = [],
  initialMeTabProfileHeroFrames = [],
  initialReferralBannerFrames = [],
  initialReferralCode = null,
}: ProfileTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollByTabRef = useRef<Record<ProfileTabId, number>>({ plus: 0, me: 0 });
  const restoreAfterTabChangeRef = useRef(false);
  const processedModifyIdRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<ProfileTabId>(parseProfileTab(initialTab));
  const [headerData, setHeaderData] = useState<ProfileHeaderData>({
    ...DEFAULT_HEADER_DATA,
    displayName: initialDisplayName || DEFAULT_HEADER_DATA.displayName,
    completionScore: 0,
  });
  const [isLoadingHeader, setIsLoadingHeader] = useState(true);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const hasWarmHeaderDataRef = useRef(false);
  const [gamificationData, setGamificationData] = useState<ProfileGamificationData>(DEFAULT_GAMIFICATION_DATA);
  const [isLoadingGamification, setIsLoadingGamification] = useState(true);
  const [onboardingProcess, setOnboardingProcess] = useState<string | null>(null);
  const shouldGuideProfileCompletion = onboardingProcess === "profile";
  useEffect(() => {
    const cached = readWarmProfileHeaderCache();
    if (!cached) return;
    setHeaderData(cached);
    setIsLoadingHeader(false);
    hasWarmHeaderDataRef.current = true;
  }, []);

  const fetchHeaderData = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (options?.forceRefresh || !hasWarmHeaderDataRef.current) {
      setIsLoadingHeader(true);
    }
    setHeaderError(null);
    const supabase = createSupabaseBrowserClient() as any;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setHeaderError("Session invalide");
      setIsLoadingHeader(false);
      return;
    }

    const cachedHeaderData = options?.forceRefresh ? null : readProfileHeaderCache(user.id);
    if (cachedHeaderData) {
      setHeaderData(cachedHeaderData);
      hasWarmHeaderDataRef.current = true;
      setIsLoadingHeader(false);
      return;
    }

    const [
      { data: userProfileRow, error: userProfileError },
      { data: onboardingRow },
      { data: identityVerificationRow, error: identityVerificationError },
    ] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("onboarding_sessions").select("status").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_identity_verifications").select("verification_status").eq("user_id", user.id).maybeSingle(),
    ]);

    if (userProfileError) {
      setHeaderError("Impossible de charger le profil");
      setIsLoadingHeader(false);
      return;
    }

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
    const persistedScore = await persistProfileCompletionScore(supabase);
    const completionFromDb = fromDb.completionScore;
    const completionScore =
      typeof persistedScore === "number"
        ? persistedScore
        : typeof completionFromDb === "number"
          ? Math.max(0, Math.min(100, Math.round(completionFromDb)))
          : onboardingRow?.status === "completed"
            ? 100
            : 0;

    const nextHeaderData: ProfileHeaderData = {
      displayName: fromDb.displayName || initialDisplayName || "Profil",
      avatarUrl: resolvedAvatarUrl,
      profilePhotoPath: fromDb.profilePhotoPath ?? null,
      avatarTransform: fromDb.avatarTransform ?? DEFAULT_HEADER_DATA.avatarTransform,
      kycStatus: fromDb.kycStatus ?? "unknown",
      completionScore,
    };

    if (identityVerificationError) {
    } else if (identityVerificationRow) {
      const identityKycStatus = getKycStatusFromVerificationRow(identityVerificationRow as Record<string, unknown>);
      nextHeaderData.kycStatus = identityKycStatus;
    }

    setHeaderData(nextHeaderData);
    writeProfileHeaderCache(user.id, nextHeaderData);
    hasWarmHeaderDataRef.current = true;
    setIsLoadingHeader(false);
  }, [initialDisplayName]);

  useEffect(() => {
    void fetchHeaderData();
  }, [fetchHeaderData]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient() as any;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("users")
        .select("onboarding_process")
        .eq("id", user.id)
        .maybeSingle();
      const userRow = data as { onboarding_process?: string | null } | null;
      if (!cancelled) setOnboardingProcess(userRow?.onboarding_process ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void fetchHeaderData();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchHeaderData]);

  const fetchGamificationData = useCallback(async () => {
    setIsLoadingGamification(true);
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setGamificationData(DEFAULT_GAMIFICATION_DATA);
      setIsLoadingGamification(false);
      return;
    }

    const [levelsRes, badgesRes, stateRes, progressRpc, streakRes] = await Promise.all([
      supabase.from("xp_levels").select("level_no,xp_required,rank_name").order("level_no", { ascending: true }),
      supabase.from("xp_badges").select("badge_code,label,description,icon,metadata").eq("is_active", true).order("created_at", { ascending: true }),
      supabase.from("xp_user_state").select("total_xp,current_level").eq("user_id", user.id).maybeSingle(),
      supabase.rpc("xp_get_badges_progress"),
      supabase.from("xp_streak").select("current_streak_days").eq("user_id", user.id).maybeSingle(),
    ]);

    const totalXp = Number(stateRes.data?.total_xp ?? 0) || 0;
    const currentLevelNoFromState = Number(stateRes.data?.current_level ?? 1) || 1;
    const dayStreak = Number(streakRes.data?.current_streak_days ?? 0) || 0;

    const levels = (levelsRes.data ?? []) as Array<{ level_no: number; xp_required: number; rank_name: string }>;
    const badges = (badgesRes.data ?? []) as Array<{ badge_code: string; label: string; description: string | null; icon: string | null; metadata?: { threshold?: number | string } | null }>;

    const defaultBadges: BadgeProgressItem[] = badges.map((badge) => {
      const threshold = Math.max(1, Number(badge.metadata?.threshold ?? 1) || 1);
      return {
        badge_code: badge.badge_code,
        label: badge.label,
        description: badge.description,
        icon: badge.icon,
        current_value: 0,
        target_value: threshold,
        is_completed: false,
      };
    });

    const progressRows = (progressRpc.data ?? []) as Array<Record<string, unknown>>;
    const badgeProgress: BadgeProgressItem[] =
      progressRows.length > 0
        ? progressRows.map((row) => ({
            badge_code: String(row.badge_code ?? ""),
            label: String(row.label ?? ""),
            description: typeof row.description === "string" ? row.description : null,
            icon: typeof row.icon === "string" ? row.icon : null,
            current_value: Number(row.current_value ?? 0) || 0,
            target_value: Math.max(1, Number(row.target_value ?? 1) || 1),
            is_completed: Boolean(row.is_completed),
          }))
        : defaultBadges;

    let currentLevelNo = 1;
    let currentRank = "Nouvelle";
    let nextRank: string | null = null;
    let remainingToNext = 0;
    let progressPercent = 0;

    if (levels.length > 0) {
      const fallbackIndex = levels.findIndex((level) => level.level_no === currentLevelNoFromState);
      const derivedIndex = levels.findLastIndex((level) => totalXp >= level.xp_required);
      const currentIndex = fallbackIndex >= 0 ? fallbackIndex : Math.max(0, derivedIndex);
      const currentLevel = levels[currentIndex] ?? levels[0];
      const nextLevel = levels[currentIndex + 1] ?? null;

      currentLevelNo = currentLevel.level_no;
      currentRank = currentLevel.rank_name;
      nextRank = nextLevel?.rank_name ?? null;

      if (nextLevel) {
        const span = Math.max(1, nextLevel.xp_required - currentLevel.xp_required);
        const progressed = Math.max(0, totalXp - currentLevel.xp_required);
        progressPercent = Math.max(0, Math.min(100, (progressed / span) * 100));
        remainingToNext = Math.max(0, nextLevel.xp_required - totalXp);
      } else {
        progressPercent = 100;
      }
    }

    setGamificationData({
      dayStreak,
      totalXp,
      currentLevelNo,
      currentRank,
      nextRank,
      remainingToNext,
      progressPercent,
      badges: badgeProgress,
    });
    setIsLoadingGamification(false);
  }, []);

  useEffect(() => {
    if (activeTab !== "me") return;
    void fetchGamificationData();
  }, [activeTab, fetchGamificationData]);

  const handleOpenPhotoModify = useCallback(async () => {
    if (!headerData.avatarUrl) {
      router.push(`/profile/complete?tab=${activeTab}`);
      return;
    }

    const draftId = crypto.randomUUID();
    savePhotoModifyDraft({
      id: draftId,
      source: "profile",
      returnPath: `/profile?tab=${activeTab}`,
      dataUrl: headerData.avatarUrl,
      originalStoragePath: headerData.profilePhotoPath ?? undefined,
      fileName: "profile-photo.jpg",
      mimeType: "image/jpeg",
      aspect: "square",
      offset: headerData.avatarTransform.offset,
      zoom: headerData.avatarTransform.zoom,
      status: "pending",
      isRemoteSource: true,
    });
    router.push(`/modify?id=${encodeURIComponent(draftId)}`);
  }, [activeTab, headerData.avatarTransform.offset, headerData.avatarTransform.zoom, headerData.avatarUrl, headerData.profilePhotoPath, router]);

  useEffect(() => {
    const tabFromQuery = parseProfileTab(searchParams.get("tab"));
    setActiveTab(tabFromQuery);
    restoreAfterTabChangeRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("tab") !== "security") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "me");
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    if (processedModifyIdRef.current === modifiedId) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || draft.source !== "profile") return;
    processedModifyIdRef.current = modifiedId;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;

    if (draft.status === "cancelled") {
      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });
      return;
    }

    if (draft.status !== "confirmed") return;

    void (async () => {
      const supabase = createSupabaseBrowserClient() as any;
      const previousHeaderData = headerData;
      const optimisticPath = draft.originalStoragePath ?? headerData.profilePhotoPath ?? null;
      setHeaderData((current) => ({
        ...current,
        avatarUrl: draft.dataUrl || current.avatarUrl,
        profilePhotoPath: optimisticPath,
        avatarTransform: {
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        },
      }));
      setIsLoadingHeader(false);

      const { error: profileError } = await measureClientPhotoPerf("photo.profileRpc", () =>
        supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            photos: {
              profile_photo_selected: true,
              profile_photo_name: draft.fileName,
              profile_photo_path: optimisticPath,
              profile_photo_transform: {
                offset: { x: draft.offset.x, y: draft.offset.y },
                zoom: draft.zoom,
                aspect: "square",
              },
            },
          },
          p_request_id: crypto.randomUUID(),
        }),
        { source: "profile" },
      );

      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });

      if (profileError) {
        setHeaderData(previousHeaderData);
        setHeaderError(profileError.message);
        return;
      }

      await measureClientPhotoPerf("photo.profileHeaderRefetch", () => fetchHeaderData({ forceRefresh: true }), {
        source: "profile",
      });
    })();
  }, [fetchHeaderData, headerData, pathname, router, searchParams]);

  useEffect(() => {
    if (!restoreAfterTabChangeRef.current) return;
    const container = panelRef.current;
    if (!container) return;
    restoreAfterTabChangeRef.current = false;
    const targetTop = scrollByTabRef.current[activeTab] ?? 0;
    container.scrollTo({ top: targetTop, behavior: "auto" });
  }, [activeTab]);

  const handlePanelScroll = () => {
    const container = panelRef.current;
    if (!container) return;
    scrollByTabRef.current[activeTab] = container.scrollTop;
  };

  const setTab = (tab: ProfileTabId) => {
    if (tab === activeTab) return;
    const container = panelRef.current;
    if (container) {
      scrollByTabRef.current[activeTab] = container.scrollTop;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTabsKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = PROFILE_TABS.findIndex((tab) => tab.id === activeTab);
    if (index === -1) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = PROFILE_TABS[(index + 1) % PROFILE_TABS.length];
      setTab(next.id);
      tabsRef.current[(index + 1) % PROFILE_TABS.length]?.focus();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const nextIndex = (index - 1 + PROFILE_TABS.length) % PROFILE_TABS.length;
      setTab(PROFILE_TABS[nextIndex].id);
      tabsRef.current[nextIndex]?.focus();
    }
  };

  const subtitle = !isLoadingHeader && headerData.completionScore < 100 ? "Profil incomplet" : "";

  const meProfileHeroRows = useMemo(
    () => initialMeTabProfileHeroFrames.filter((row) => row.frame_type === "profile_plus_hero"),
    [initialMeTabProfileHeroFrames],
  );

  const referralBannerRow = useMemo(
    () => initialReferralBannerFrames.find((row) => row.frame_type === "shop_link_card") ?? null,
    [initialReferralBannerFrames],
  );

  const panelContent = useMemo(() => {
    if (activeTab === "plus") {
      return (
        <div className="space-y-5">
          {initialPlusTabCmsFrames.length > 0 ? (
            <CmsLinkCardCtaToneProvider tone="neutral">
              <div
                className="-mx-5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-pl-5 scroll-pr-5 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex w-max max-w-none touch-pan-x gap-3 pr-5">
                  {/* Spacer + snap-padding : sans ça, snap-mandatory aligne la 1ʳᵉ carte au bord et « mange » le padding gauche du flex. */}
                  <div className="w-5 shrink-0 snap-normal" aria-hidden />
                  {initialPlusTabCmsFrames.map((row) => (
                    <div
                      key={row.id}
                      className="w-[min(90vw,420px)] max-w-[420px] shrink-0 snap-start"
                    >
                      <CmsFrameItem
                        row={row}
                        layoutMode={row.frame_type === "profile_plus_hero" ? "stack" : "hub"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CmsLinkCardCtaToneProvider>
          ) : null}
          <CommunityShareActions referralCode={initialReferralCode} referralBannerRow={referralBannerRow} />
          <div className="grid w-full min-w-0 grid-cols-2 items-stretch gap-2.5">
            <div className={PROFILE_REVIEW_CARD_SHELL}>
              <TrustpilotReviewCta variant="inset" className="min-h-0" />
            </div>
            <div className={PROFILE_REVIEW_CARD_SHELL}>
              <GoogleReviewCta variant="inset" className="min-h-0" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {!isLoadingHeader && headerData.kycStatus !== "verified" ? (
          <Link href="/profile/kyc?tab=me" className="block">
            <CardBase className="flex items-center gap-3">
              <BadgeCheck
                className={headerData.kycStatus === "rejected" ? "text-[#E44D3E]" : "text-zinc-500"}
              />
              <div>
                <p className="text-xl font-semibold text-zinc-900">
                  {headerData.kycStatus === "rejected" ? "Vérification refusée" : "Vérification d'identité"}
                </p>
                <p className="text-sm text-zinc-600">
                  {headerData.kycStatus === "rejected"
                    ? "Action requise : relance la vérification avec un document conforme."
                    : "Ton identité n'a pas encore été vérifiée."}
                </p>
              </div>
            </CardBase>
          </Link>
        ) : null}
        {meProfileHeroRows.length > 0 ? (
          <CmsLinkCardCtaToneProvider tone="neutral">
            {meProfileHeroRows.length > 1 ? (
              <div
                className="-mx-5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-pl-5 scroll-pr-5 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex w-max max-w-none touch-pan-x gap-3 pr-5">
                  <div className="w-5 shrink-0 snap-normal" aria-hidden />
                  {meProfileHeroRows.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        "w-[min(90vw,420px)] max-w-[420px] shrink-0 snap-start",
                        shouldGuideProfileCompletion && isProfileCompletionHeroRow(row) && "segna-guidance-shimmer-active",
                      )}
                    >
                      <CmsFrameItem row={row} layoutMode="stack" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex justify-center">
                <div
                  className={cn(
                    "w-full max-w-[420px]",
                    shouldGuideProfileCompletion &&
                      isProfileCompletionHeroRow(meProfileHeroRows[0]) &&
                      "segna-guidance-shimmer-active",
                  )}
                >
                  <CmsFrameItem row={meProfileHeroRows[0]} layoutMode="stack" />
                </div>
              </div>
            )}
          </CmsLinkCardCtaToneProvider>
        ) : (
          <CardBase className="space-y-2 text-center">
            <div className="relative mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100">
              <Image
                src="/ressources/segna_logo.svg"
                alt="Segna"
                width={64}
                height={64}
                className="pointer-events-none absolute left-1/2 top-1/2 h-[84%] w-[84%] -translate-x-1/2 -translate-y-1/2 object-contain object-center"
              />
              {!isLoadingHeader && headerData.completionScore < 100 ? (
                <span className="absolute right-0 top-0 z-20 inline-flex h-4 w-4 translate-x-[10%] -translate-y-[10%] items-center justify-center rounded-full bg-[#E25745] text-[10px] font-bold text-white shadow-sm">
                  !
                </span>
              ) : null}
            </div>
            <h3 className="text-[20px] font-semibold text-zinc-900">
              {isLoadingHeader ? "Chargement du profil..." : headerData.completionScore < 100 ? "Complète ton profil" : "Modifie ton profil"}
            </h3>
            <p className="text-[18px] font-extrabold leading-tight text-zinc-900">
              {isLoadingHeader
                ? "On met à jour tes informations."
                : headerData.completionScore < 100
                ? "Tu y es presque : encore quelques détails à ajouter pour commencer à matcher."
                : (
                  <>
                    Mets-le à jour à tout moment pour qu&apos;il reste fidèle à ta réalité.
                  </>
                )}
            </p>
            <Link
              href="/profile/complete?tab=me"
              className={cn(
                "segna-guidance-shimmer-target mt-4 inline-flex h-11 min-w-[170px] items-center justify-center rounded-full border border-zinc-500 px-5 text-base font-semibold text-zinc-900 transition hover:bg-zinc-50",
                shouldGuideProfileCompletion && "segna-guidance-shimmer-active",
              )}
            >
              Modifie ton profil
            </Link>
          </CardBase>
        )}

        {isLoadingGamification ? (
          <CardBase className="space-y-3 animate-pulse" aria-hidden>
            {PROFILE_PLUS_SHOW_GAMIFICATION_EXTRAS ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-20 rounded-xl bg-zinc-100" />
                  <div className="h-20 rounded-xl bg-zinc-100" />
                </div>
                <div className="h-24 rounded-xl bg-zinc-100" />
                <div className="h-28 rounded-xl bg-zinc-100" />
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between gap-3">
                  <div className="h-5 w-44 rounded bg-zinc-100" />
                  <div className="h-4 w-14 shrink-0 rounded bg-zinc-100" />
                </div>
                <div className="h-2.5 w-full rounded-full bg-zinc-100" />
                <div className="h-4 w-full max-w-[92%] rounded bg-zinc-100" />
              </div>
            )}
          </CardBase>
        ) : (
          <>
            {PROFILE_PLUS_SHOW_GAMIFICATION_EXTRAS ? (
              <div className="grid grid-cols-2 gap-3">
                <CardBase className="space-y-1">
                  <p className="text-sm text-zinc-500">Day streak</p>
                  <p className="text-xl font-semibold text-zinc-900">{gamificationData.dayStreak} jours</p>
                </CardBase>
                <CardBase className="space-y-1">
                  <p className="text-sm text-zinc-500">Confiance</p>
                  <p className="text-xl text-[#D4A017]">★★★★★</p>
                </CardBase>
              </div>
            ) : null}

            <CardBase className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base font-semibold text-zinc-900">
                  Niveau {gamificationData.currentLevelNo} -{" "}
                  <span className="font-semibold italic">{gamificationData.currentRank}</span>
                </p>
                <p className="text-sm font-medium text-zinc-600">{gamificationData.totalXp} XP</p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full rounded-full bg-zinc-900 transition-all" style={{ width: `${gamificationData.progressPercent}%` }} />
              </div>
              <p className="text-sm text-zinc-600">
                {gamificationData.nextRank ? (
                  <>
                    {gamificationData.remainingToNext} XP restants pour atteindre{" "}
                    <span className="italic">{gamificationData.nextRank}</span>.
                  </>
                ) : (
                  "Palier maximum atteint."
                )}
              </p>
            </CardBase>

            {PROFILE_PLUS_SHOW_GAMIFICATION_EXTRAS ? (
              <CardBase className="space-y-3">
                <CommunityBadgesGrid badges={gamificationData.badges} />
              </CardBase>
            ) : null}
          </>
        )}
      </div>
    );
  }, [
    activeTab,
    gamificationData,
    headerData.completionScore,
    headerData.kycStatus,
    initialPlusTabCmsFrames,
    initialReferralCode,
    referralBannerRow,
    isLoadingGamification,
    isLoadingHeader,
    meProfileHeroRows,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={panelRef} onScroll={handlePanelScroll} className="min-h-0 flex-1 overflow-y-auto pb-28">
        <header className="px-5 pt-6">
          <div className="flex h-6 items-center justify-between">
            <Image src="/ressources/segna_logo.svg" alt="Segna" width={96} height={24} priority className="h-6 w-auto" />
            <Link
              href={`/profile/settings?tab=${activeTab}`}
              aria-label="Reglages"
              className="inline-flex h-full aspect-square items-center justify-center text-black transition hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              <Settings className="h-full w-full" strokeWidth={2.1} />
            </Link>
          </div>

          {isLoadingHeader ? (
            <div className="mt-5 flex flex-col items-center animate-pulse" aria-hidden>
              <div className="h-44 w-44 rounded-full bg-zinc-200" />
              <div className="mt-4 h-8 w-44 rounded-md bg-zinc-200" />
              <div className="mt-2 h-5 w-28 rounded-md bg-zinc-100" />
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center">
              <ProfileProgressAvatar
                completionScore={headerData.completionScore}
                avatarUrl={headerData.avatarUrl}
                avatarTransform={headerData.avatarTransform}
                displayName={headerData.displayName}
                onPhotoClick={handleOpenPhotoModify}
                editHref={`/profile/complete?tab=${activeTab}`}
              />

              <ProfileIdentitySummary displayName={headerData.displayName} subtitle={subtitle} kycStatus={headerData.kycStatus} />
              {headerError ? (
                <button
                  type="button"
                  onClick={() => void fetchHeaderData()}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 underline"
                >
                  Reessayer
                </button>
              ) : null}
            </div>
          )}
        </header>

        <div className="sticky top-0 z-10 mt-4 border-b border-zinc-200 bg-white/95 backdrop-blur">
          <div role="tablist" aria-label="Sections profile" onKeyDown={handleTabsKeyboard} className="grid grid-cols-2 px-2">
            {PROFILE_TABS.map((tab, index) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabsRef.current[index] = node;
                  }}
                  id={`profile-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`profile-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                  onClick={() => setTab(tab.id)}
                  className={cn(
                    "min-h-[48px] border-b-2 px-2 text-[18px] font-semibold leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900",
                    isActive ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400",
                  )}
                >
                  {tab.label}
                  {tab.id === "me" && !isLoadingHeader && headerData.completionScore < 100 ? (
                    <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-red-500 align-middle" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <section id={`profile-panel-${activeTab}`} role="tabpanel" aria-labelledby={`profile-tab-${activeTab}`} className="px-5 pb-8 pt-4">
          <div className="transition-all duration-200 ease-out">{panelContent}</div>
        </section>
      </div>
    </div>
  );
}
