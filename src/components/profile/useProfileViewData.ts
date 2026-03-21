"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ProfileViewBrand,
  ProfileViewData,
  ProfileViewInfoCardData,
  ProfileViewInfoItem,
  ProfileViewInsight,
  ProfileViewLookSlot,
} from "./ProfileView";

const MODIFY_CACHE_KEY = "segna:profile-complete:modify-cache:v1";

type CachedLookSlot = {
  dataUrl: string;
  offset: { x: number; y: number };
  zoom: number;
  imageRatio: number;
};

type CachedPayload = {
  profilePhoto: CachedLookSlot | null;
  looksSlots: Array<CachedLookSlot | null>;
  infoItems: Array<{ id: string; label: string; value: string; visibility: string }>;
  styleItems: Array<{ id: string; label: string; value: string }>;
  infoVisibilityMap?: Record<string, boolean>;
  answers?: { prompt0: string; prompt1: string; prompt2: string; response0: string; response1: string; response2: string };
  infoCard?: ProfileViewInfoCardData;
};

function readModifyCache(): CachedPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(MODIFY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.looksSlots) || parsed.looksSlots.length !== 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildInfoCardFromCache(cache: CachedPayload, displayName: string | null, cityFromDb: string | null): ProfileViewInfoCardData {
  const base = cache.infoCard
    ? { ...cache.infoCard, displayName: displayName ?? cache.infoCard.displayName ?? null }
    : {
        age: cache.infoItems?.find((i) => i.id === "age")?.value ?? null,
        ratingValue: "5.0",
        ratingStars: 5,
        levelIcon: "🌱",
        levelNumber: 1,
        smoking: true,
        alcohol: true,
        sport: false,
        night: true,
        city: null,
        profession: cache.infoItems?.find((i) => i.id === "work")?.value ?? null,
        instagramHandle: null,
        displayName: displayName ?? null,
      };
  return { ...base, city: cityFromDb ?? base.city };
}

function cacheToProfileViewData(cache: CachedPayload, displayName?: string | null, cityFromDb?: string | null): ProfileViewData {
  const visibilityMap = cache.infoVisibilityMap ?? {};
  const infoItems: ProfileViewInfoItem[] = cache.infoItems.map((item) => ({
    ...item,
    visibility: (visibilityMap[item.id] !== false ? "visible" : "hidden") as "visible" | "hidden",
  }));

  const brandsItem = cache.styleItems?.find((s) => s.id === "brands");
  const brandsLabel = brandsItem?.value ?? "";
  const brands: ProfileViewBrand[] = brandsLabel
    ? brandsLabel.split(",").map((label) => ({ id: "", label: label.trim(), logoUrl: null })).filter((b) => b.label)
    : [];

  const answers = cache.answers ?? {
    prompt0: "",
    prompt1: "",
    prompt2: "",
    response0: "",
    response1: "",
    response2: "",
  };
  const insights: ProfileViewInsight[] = [
    { prompt: answers.prompt0 ?? "", response: answers.response0 ?? "" },
    { prompt: answers.prompt1 ?? "", response: answers.response1 ?? "" },
    { prompt: answers.prompt2 ?? "", response: answers.response2 ?? "" },
  ];

  const toLookSlot = (slot: CachedLookSlot | null): ProfileViewLookSlot | null =>
    slot ? { dataUrl: slot.dataUrl, offset: slot.offset, zoom: slot.zoom, imageRatio: slot.imageRatio } : null;

  return {
    profilePhoto: toLookSlot(cache.profilePhoto),
    infoCard: buildInfoCardFromCache(cache, displayName ?? null, cityFromDb ?? null),
    looksSlots: cache.looksSlots.map(toLookSlot),
    infoItems,
    brands,
    insights,
    lentPieces: [],
    instagramUsername: null,
    locationLabel: infoItems.find((i) => i.id === "location")?.value ?? null,
    statsValue: null,
  };
}

export function useProfileViewData(userId?: string | null, displayName?: string | null) {
  const [data, setData] = useState<ProfileViewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadFromCache = useCallback(async () => {
    const cache = readModifyCache();
    if (!cache) return false;
    const supabase = createSupabaseBrowserClient() as any;
    let cityFromDb: string | null = null;
    let brandsFromDb: ProfileViewBrand[] = [];
    try {
      const { data: user } = await supabase.auth.getUser();
      if (user?.user?.id) {
        const [cityRes, profileRes] = await Promise.all([
          supabase.from("user_profiles").select("city").eq("user_id", user.user.id).maybeSingle(),
          supabase.from("user_profiles").select("id").eq("user_id", user.user.id).maybeSingle(),
        ]);
        cityFromDb = (cityRes.data as { city?: string } | null)?.city?.trim() ?? null;
        const profileId = (profileRes.data as { id?: string } | null)?.id;
        if (profileId) {
          const { data: brandsRows } = await supabase
            .from("user_profile_brands")
            .select("brand_id")
            .eq("user_profile_id", profileId)
            .order("rank", { ascending: true });
          const ids = (brandsRows ?? []).map((r: { brand_id?: string }) => r.brand_id).filter((id: string | undefined): id is string => Boolean(id));
          if (ids.length > 0) {
            const { data: brandItems } = await supabase.from("item_brands").select("id,label,logo_path").in("id", ids);
            const orderMap = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));
            const items = (brandItems ?? []) as Array<{ id: string; label: string | null; logo_path?: string | null }>;
            const brandLogosBucket = supabase.storage.from("brand_logos");
            brandsFromDb = items
              .sort((a, b) => Number(orderMap.get(a.id) ?? 0) - Number(orderMap.get(b.id) ?? 0))
              .map((b) => {
                const logoPath = typeof b.logo_path === "string" && b.logo_path.trim() ? b.logo_path.trim() : null;
                const logoUrl = logoPath ? brandLogosBucket.getPublicUrl(logoPath).data.publicUrl : null;
                return { id: b.id, label: b.label ?? "", logoUrl };
              });
          }
        }
      }
    } catch {
      // ignore
    }
    const viewData = cacheToProfileViewData(cache, displayName ?? null, cityFromDb);
    setData({
      ...viewData,
      brands: brandsFromDb.length > 0 ? brandsFromDb : viewData.brands,
    });
    setIsLoading(false);
    return true;
  }, [displayName]);

  const fetchFromDb = useCallback(async () => {
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsLoading(false);
      return;
    }

    const targetUserId = userId ?? user.id;
    const { data: row, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (error || !row) {
      setIsLoading(false);
      return;
    }

    const profileRow = (row ?? {}) as Record<string, unknown>;
    const profileData = (profileRow.profile_data ?? {}) as Record<string, unknown>;
    const profileId = typeof profileRow.id === "string" ? profileRow.id : null;

    const parsePhotoPath = () => {
      const photos = (profileRow.photos ?? {}) as Record<string, unknown>;
      const photosProfile = (photos.profile ?? {}) as Record<string, unknown>;
      const candidates = [
        photos.profile_photo_path,
        photos.profilePhotoPath,
        photosProfile.profile_photo_path,
        photosProfile.profilePhotoPath,
      ];
      return candidates.find((v) => typeof v === "string" && (v as string).trim().length > 0)?.toString().trim() ?? null;
    };

    const profilePath = parsePhotoPath();
    const bucket = supabase.storage.from("bucket_focus");
    const getSignedUrl = async (path: string) => {
      const { data: signed } = await bucket.createSignedUrl(path, 60 * 60 * 24);
      return signed?.signedUrl ?? bucket.getPublicUrl(path).data.publicUrl ?? path;
    };

    const parseLooksRaw = () => {
      const looksRaw = profileRow.looks ?? (profileData.looks ?? {});
      if (!looksRaw || typeof looksRaw !== "object") return [null, null, null];
      const rec = looksRaw as Record<string, unknown>;
      return [rec.look1, rec.look2, rec.look3].map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null));
    };

    const looksRaw = parseLooksRaw();
    const lookPaths = looksRaw
      .map((r) => {
        const sp = r?.storage_path ?? r?.url ?? r?.path;
        return typeof sp === "string" && sp.trim() ? sp.trim() : null;
      })
      .filter((p): p is string => Boolean(p));

    const pathsToResolve = [...(profilePath ? [profilePath] : []), ...lookPaths];
    const urlByPath: Record<string, string> = {};
    for (const path of pathsToResolve) {
      try {
        urlByPath[path] = await getSignedUrl(path);
      } catch {
        urlByPath[path] = bucket.getPublicUrl(path).data.publicUrl ?? path;
      }
    }

    const getImageRatio = (url: string) =>
      new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.width > 0 && img.height > 0 ? img.width / img.height : 1);
        img.onerror = () => resolve(1);
        img.src = url;
      });

    const clamp = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

    let profilePhoto: ProfileViewLookSlot | null = null;
    if (profilePath) {
      const url = urlByPath[profilePath] ?? profilePath;
      const transform = (profileRow.photos as Record<string, unknown>)?.profile_photo_transform as Record<string, unknown> | undefined;
      const offsetRaw = (transform?.offset ?? {}) as Record<string, unknown>;
      const zoom = typeof transform?.zoom === "number" ? transform.zoom : 1;
      profilePhoto = {
        dataUrl: url,
        offset: { x: clamp(offsetRaw.x), y: clamp(offsetRaw.y) },
        zoom,
        imageRatio: await getImageRatio(url),
      };
    }

    const looksSlots: Array<ProfileViewLookSlot | null> = await Promise.all(
      looksRaw.map(async (r) => {
        if (!r) return null;
        const sp = r.storage_path ?? r.url ?? r.path;
        const path = typeof sp === "string" && sp.trim() ? sp.trim() : null;
        if (!path) return null;
        const url = urlByPath[path] ?? path;
        const pos = (r.position ?? {}) as Record<string, unknown>;
        const off = (pos.offset ?? {}) as Record<string, unknown>;
        return {
          dataUrl: url,
          offset: { x: clamp(off.x), y: clamp(off.y) },
          zoom: typeof pos.zoom === "number" ? pos.zoom : 1,
          imageRatio: await getImageRatio(url),
        };
      }),
    );
    while (looksSlots.length < 3) looksSlots.push(null);

    const parseAnswers = () => {
      const src = profileRow.answers ?? (profileData.answers as Array<{ prompt?: string; response?: string }> | undefined);
      if (!Array.isArray(src)) return [{ prompt: "", response: "" }, { prompt: "", response: "" }, { prompt: "", response: "" }];
      return src.slice(0, 3).map((a) => ({ prompt: a?.prompt ?? "", response: a?.response ?? "" }));
    };
    const answers = parseAnswers();

    let brands: ProfileViewBrand[] = [];
    if (profileId) {
      const { data: brandsRows } = await supabase
        .from("user_profile_brands")
        .select("brand_id")
        .eq("user_profile_id", profileId)
        .order("rank", { ascending: true });
      const ids = (brandsRows ?? []).map((r: { brand_id?: string }) => r.brand_id).filter((id: string | undefined): id is string => Boolean(id));
      if (ids.length > 0) {
        const { data: brandItems } = await supabase
          .from("item_brands")
          .select("id,label,logo_path")
          .in("id", ids);
        const orderMap = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));
        const items = (brandItems ?? []) as Array<{ id: string; label: string | null; logo_path?: string | null }>;
        const brandLogosBucket = supabase.storage.from("brand_logos");
        brands = items
          .sort((a, b) => Number(orderMap.get(a.id) ?? 0) - Number(orderMap.get(b.id) ?? 0))
          .map((b) => {
            const logoPath = typeof b.logo_path === "string" && b.logo_path.trim() ? b.logo_path.trim() : null;
            const logoUrl = logoPath ? brandLogosBucket.getPublicUrl(logoPath).data.publicUrl : null;
            return { id: b.id, label: b.label ?? "", logoUrl };
          });
      }
    }

    const cityLabel = (profileRow.city as string)?.trim() ?? "";

    const toDisplay = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

    const ageStr = toDisplay(profileRow.age ?? profileData.age);
    const workStr = toDisplay(profileData.work);
    const instagramHandle = (profileData.instagram_username ?? profileRow.instagram_username) as string | null;
    const displayName = (profileRow.display_name ?? profileData.display_name) as string | null;

    let levelIcon = "🌱";
    const [stateRes, levelsRes] = await Promise.all([
      supabase.from("xp_user_state").select("current_level").eq("user_id", targetUserId).maybeSingle(),
      supabase.from("xp_levels").select("level_no,icon").order("level_no", { ascending: true }),
    ]);
    const currentLevel = Number(stateRes.data?.current_level ?? 1) || 1;
    const levels = (levelsRes.data ?? []) as Array<{ level_no: number; icon?: string | null }>;
    const levelRow = levels.find((l) => l.level_no === currentLevel) ?? levels[0];
    if (levelRow) {
      levelIcon = levelRow.icon ?? "🌱";
    }

    const infoCard: ProfileViewInfoCardData = {
      age: ageStr || null,
      ratingValue: "5.0",
      ratingStars: 5,
      levelIcon,
      levelNumber: currentLevel,
      smoking: true,
      alcohol: true,
      sport: false,
      night: true,
      city: cityLabel || null,
      profession: workStr || null,
      instagramHandle: instagramHandle?.trim() || null,
      displayName: displayName?.trim() || null,
    };

    const infoItems = [
      { id: "age", label: "Âge", value: ageStr, visibility: "visible" as const },
      { id: "location", label: "Position", value: cityLabel, visibility: "visible" as const },
      { id: "work", label: "Profession", value: workStr, visibility: "visible" as const },
    ]
      .filter((i) => i.value.length > 0) as ProfileViewInfoItem[];

    setData({
      profilePhoto,
      infoCard,
      looksSlots,
      infoItems,
      brands,
      insights: answers,
      lentPieces: [],
      instagramUsername: instagramHandle ?? displayName,
      locationLabel: cityLabel || null,
      statsValue: null,
    });
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    void (async () => {
      const fromCache = await loadFromCache();
      if (!fromCache) void fetchFromDb();
    })();
  }, [loadFromCache, fetchFromDb]);

  return { data, isLoading, refetch: fetchFromDb };
}
