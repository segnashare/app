"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Settings, Sparkles, CircleHelp, CircleAlert, Shield, Flag, Ban, PhoneCall } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CardBase } from "@/components/layout/CardBase";
import { CommunityBadgesGrid } from "@/components/community/CommunityBadgesGrid";
import { ProfileIdentitySummary } from "@/components/profile/ProfileIdentitySummary";
import { MarketplaceSection, type MarketplaceMembershipTier } from "@/components/profile/MarketplaceSection";
import { ProfileProgressAvatar } from "@/components/profile/ProfileProgressAvatar";
import { readPhotoModifyDraft, removePhotoModifyDraft, savePhotoModifyDraft } from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PROFILE_TABS = [
  { id: "plus", label: "Obtenir plus" },
  { id: "security", label: "Sécurité" },
  { id: "me", label: "Mon profil" },
] as const;

type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

type ProfileTabsProps = {
  initialTab?: string;
  initialDisplayName?: string;
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

type MembershipStateRpc = {
  plan_code?: string | null;
  subscription_status?: string | null;
};

function getMembershipTierFromState(state: MembershipStateRpc | null | undefined): MarketplaceMembershipTier {
  const planCode = String(state?.plan_code ?? "").toLowerCase();
  const status = String(state?.subscription_status ?? "").toLowerCase();
  const isActive = status === "active" || status === "trialing";
  if (!isActive) return "guest";
  if (planCode === "segna_x") return "segna_x";
  if (planCode === "segna_plus") return "segna_plus";
  return "guest";
}

function getMembershipTierFromRoles(roles: string[]): MarketplaceMembershipTier {
  const normalized = roles.map((role) => role.trim().toLowerCase());
  if (normalized.some((role) => role.includes("segna_x") || role.includes("membre_x") || role.includes("premium") || role.includes("member_x"))) {
    return "segna_x";
  }
  if (
    normalized.some(
      (role) =>
        role.includes("segna_plus") ||
        role.includes("membre_plus") ||
        role.includes("member_plus") ||
        role.includes("membre +") ||
        role.includes("segna+") ||
        role.includes("plus"),
    )
  ) {
    return "segna_plus";
  }
  return "guest";
}

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

const TAB_SET = new Set<ProfileTabId>(PROFILE_TABS.map((tab) => tab.id));
const PROFILE_HEADER_CACHE_KEY = "segna:profile:header:v1";
const PROFILE_HEADER_CACHE_TTL_MS = 10 * 60 * 1000;

function parseProfileTab(value: string | null | undefined): ProfileTabId {
  return value && TAB_SET.has(value as ProfileTabId) ? (value as ProfileTabId) : "plus";
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
  const avatarUrl = typeof row.avatar_url === "string" && row.avatar_url.trim() ? row.avatar_url.trim() : null;
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
  const profilePhotoPath =
    profilePhotoPathCandidates.find((value) => typeof value === "string" && value.trim().length > 0)?.toString().trim() ?? null;
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
    profilePhotoPath,
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

const urlToDataUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Impossible de charger l'image.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Impossible de lire l'image."));
    reader.readAsDataURL(blob);
  });
};

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

export function ProfileTabs({ initialTab, initialDisplayName }: ProfileTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollByTabRef = useRef<Record<ProfileTabId, number>>({ plus: 0, security: 0, me: 0 });
  const restoreAfterTabChangeRef = useRef(false);

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
  const [membershipTier, setMembershipTier] = useState<MarketplaceMembershipTier | null>(null);

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
      setMembershipTier(null);
      setIsLoadingHeader(false);
      return;
    }

    const [subscriptionRes, membershipStateRes, rolesRes] = await Promise.all([
      supabase.from("user_subscriptions").select("plan_code,status").eq("user_id", user.id).eq("provider", "stripe").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc("get_current_membership_state"),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const roles: string[] = (rolesRes.data ?? []).map((row: { role?: string | null }) => row.role ?? "").filter(Boolean);
    const tierFromRoles = getMembershipTierFromRoles(roles);
    const tierFromSubscriptionTable =
      subscriptionRes.error == null && subscriptionRes.data
        ? getMembershipTierFromState(
            {
              plan_code: (subscriptionRes.data as { plan_code?: string | null }).plan_code ?? null,
              subscription_status: (subscriptionRes.data as { status?: string | null }).status ?? null,
            } satisfies MembershipStateRpc,
          )
        : "guest";
    const tierFromMembershipRpc = membershipStateRes.error
      ? "guest"
      : getMembershipTierFromState((membershipStateRes.data ?? null) as MembershipStateRpc | null);

    const resolvedTier =
      tierFromSubscriptionTable !== "guest"
        ? tierFromSubscriptionTable
        : tierFromMembershipRpc !== "guest"
          ? tierFromMembershipRpc
          : tierFromRoles;
    setMembershipTier(resolvedTier);

    const cachedHeaderData = options?.forceRefresh ? null : readProfileHeaderCache(user.id);
    if (cachedHeaderData) {
      setHeaderData(cachedHeaderData);
      hasWarmHeaderDataRef.current = true;
      setIsLoadingHeader(false);
      return;
    }

    const [{ data: userProfileRow, error: userProfileError }, { data: onboardingRow }] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("onboarding_sessions").select("status").eq("user_id", user.id).maybeSingle(),
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
      const { data: signedData, error: signedError } = await supabase.storage
        .from("bucket_focus")
        .createSignedUrl(fromDb.profilePhotoPath, 60 * 60);
      if (!signedError && signedData?.signedUrl) {
        resolvedAvatarUrl = signedData.signedUrl;
      } else {
        const { data: downloadData, error: downloadError } = await supabase.storage.from("bucket_focus").download(fromDb.profilePhotoPath);
        if (!downloadError && downloadData) {
          resolvedAvatarUrl = URL.createObjectURL(downloadData);
        } else {
          const { data: publicData } = supabase.storage.from("bucket_focus").getPublicUrl(fromDb.profilePhotoPath);
          resolvedAvatarUrl = publicData?.publicUrl || resolvedAvatarUrl;
        }
      }
    }
    const completionFromDb = fromDb.completionScore;
    const completionScore =
      typeof completionFromDb === "number"
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

    const { data: identityVerificationRow, error: identityVerificationError } = await supabase
      .from("user_identity_verifications")
      .select("verification_status")
      .eq("user_id", user.id)
      .maybeSingle();
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

    try {
      const dataUrl = await urlToDataUrl(headerData.avatarUrl);
      const draftId = crypto.randomUUID();
      savePhotoModifyDraft({
        id: draftId,
        source: "profile",
        returnPath: `/profile?tab=${activeTab}`,
        dataUrl,
        originalStoragePath: headerData.profilePhotoPath ?? undefined,
        fileName: "profile-photo.jpg",
        mimeType: "image/jpeg",
        aspect: "square",
        offset: headerData.avatarTransform.offset,
        zoom: headerData.avatarTransform.zoom,
        status: "pending",
      });
      router.push(`/modify?id=${encodeURIComponent(draftId)}`);
    } catch {
      router.push(`/profile/complete?tab=${activeTab}`);
    }
  }, [activeTab, headerData.avatarTransform.offset, headerData.avatarTransform.zoom, headerData.avatarUrl, headerData.profilePhotoPath, router]);

  useEffect(() => {
    const tabFromQuery = parseProfileTab(searchParams.get("tab"));
    setActiveTab(tabFromQuery);
    restoreAfterTabChangeRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || draft.source !== "profile") return;

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
      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          photos: {
            profile_photo_selected: true,
            profile_photo_name: draft.fileName,
            profile_photo_path: draft.originalStoragePath ?? headerData.profilePhotoPath,
            profile_photo_transform: {
              offset: { x: draft.offset.x, y: draft.offset.y },
              zoom: draft.zoom,
              aspect: "square",
            },
          },
        },
        p_request_id: crypto.randomUUID(),
      });

      removePhotoModifyDraft(modifiedId);
      router.replace(nextUrl, { scroll: false });

      if (profileError) {
        setHeaderError(profileError.message);
        return;
      }

      await fetchHeaderData({ forceRefresh: true });
    })();
  }, [fetchHeaderData, headerData.profilePhotoPath, pathname, router, searchParams]);

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

  const panelContent = useMemo(() => {
    if (activeTab === "plus") {
      if (!membershipTier) return null;
      return <MarketplaceSection membershipTier={membershipTier} />;
    }

    if (activeTab === "security") {
      return (
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-3">
            {!isLoadingHeader && headerData.kycStatus !== "verified" && (
              <Link href="/profile/kyc?tab=security" className="block">
                <CardBase className="flex items-center gap-3">
                  <ShieldCheck className={headerData.kycStatus === "rejected" ? "text-[#E44D3E]" : "text-zinc-500"} />
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
            )}
            <Link href="/profile/reports?tab=security" className="block">
              <CardBase className="flex items-center gap-3">
                <Flag className="text-zinc-500" />
                <div>
                  <p className="text-xl font-semibold text-zinc-900">Signalements</p>
                  <p className="text-sm text-zinc-600">Masque les interactions irrespectueuses.</p>
                </div>
              </CardBase>
            </Link>
            <Link href="/profile/blocks?tab=security" className="block">
              <CardBase className="flex items-center gap-3">
                <Ban className="text-zinc-500" />
                <div>
                  <p className="text-xl font-semibold text-zinc-900">Liste rouge</p>
                  <p className="text-sm text-zinc-600">Bloque les personnes que tu connais.</p>
                </div>
              </CardBase>
            </Link>
          </section>

          <section className="mt-8 space-y-4">
            <h2 className="px-1 text-[30px] font-semibold leading-tight tracking-tight text-zinc-900">Parcours nos ressources sur la sécurité</h2>
            <div className="grid grid-cols-2 gap-3">
              <CardBase className="min-h-28">
                <PhoneCall className="text-zinc-600" />
                <p className="mt-3 text-xl font-medium text-zinc-900">Assistance d&apos;urgence</p>
              </CardBase>
              <CardBase className="min-h-28">
                <CircleHelp className="text-zinc-600" />
                <p className="mt-3 text-xl font-medium text-zinc-900">Centre d&apos;aide</p>
              </CardBase>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <CardBase className="space-y-2 text-center">
          <div className="relative mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100">
            <Image
              src="/ressources/icons/oeil_logo.svg"
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
            className="inline-flex mt-4 h-11 min-w-[170px] items-center justify-center rounded-full border border-zinc-500 px-5 text-base font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            Modifie ton profil
          </Link>
        </CardBase>

        {isLoadingGamification ? (
          <CardBase className="space-y-3 animate-pulse" aria-hidden>
            <div className="grid grid-cols-2 gap-3">
              <div className="h-20 rounded-xl bg-zinc-100" />
              <div className="h-20 rounded-xl bg-zinc-100" />
            </div>
            <div className="h-24 rounded-xl bg-zinc-100" />
            <div className="h-28 rounded-xl bg-zinc-100" />
          </CardBase>
        ) : (
          <>
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

            <CardBase className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base font-semibold text-zinc-900">
                  Niveau {gamificationData.currentLevelNo} - {gamificationData.currentRank}
                </p>
                <p className="text-sm font-medium text-zinc-600">{gamificationData.totalXp} XP</p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full rounded-full bg-[#5E3023] transition-all" style={{ width: `${gamificationData.progressPercent}%` }} />
              </div>
              <p className="text-sm text-zinc-600">
                {gamificationData.nextRank
                  ? `${gamificationData.remainingToNext} XP restants pour atteindre ${gamificationData.nextRank}.`
                  : "Palier maximum atteint."}
              </p>
            </CardBase>

            <CardBase className="space-y-3">
              <CommunityBadgesGrid badges={gamificationData.badges} />
            </CardBase>
          </>
        )}
      </div>
    );
  }, [activeTab, gamificationData, headerData.completionScore, headerData.kycStatus, isLoadingGamification, isLoadingHeader, membershipTier]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={panelRef} onScroll={handlePanelScroll} className="min-h-0 flex-1 overflow-y-auto pb-28">
        <header className="px-5 pt-6">
          <div className="flex h-6 items-center justify-between">
            <Image src="/ressources/Segna.svg" alt="Segna" width={96} height={24} priority className="h-6 w-auto" />
            <Link
              href={`/profile/settings?tab=${activeTab}`}
              aria-label="Reglages"
              className="inline-flex h-full aspect-square items-center justify-center text-black transition hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5E3023]"
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
          <div role="tablist" aria-label="Sections profile" onKeyDown={handleTabsKeyboard} className="grid grid-cols-3 px-2">
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
                    "min-h-[48px] border-b-2 px-2 text-[18px] font-semibold leading-none whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5E3023]",
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
