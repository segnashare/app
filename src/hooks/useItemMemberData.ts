"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ItemMemberSectionData } from "@/components/item/ItemMemberSection";

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function formatMemberSince(createdAt: string | null): string | null {
  if (!createdAt) return null;
  try {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    const month = MONTHS_FR[d.getMonth()] ?? "";
    const year = d.getFullYear();
    return `${month} ${year}`;
  } catch {
    return null;
  }
}

export function useItemMemberData(ownerUserId: string | null) {
  const [data, setData] = useState<ItemMemberSectionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!ownerUserId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient() as any;

    const [profileRes, verificationRes, usersRes, stateRes, levelsRes] = await Promise.all([
      supabase.from("user_profiles").select("display_name, profile_data, looks, photos").eq("user_id", ownerUserId).maybeSingle(),
      supabase.from("user_identity_verifications").select("verification_status").eq("user_id", ownerUserId).maybeSingle(),
      supabase.from("users").select("created_at").eq("id", ownerUserId).maybeSingle(),
      supabase.from("xp_user_state").select("current_level").eq("user_id", ownerUserId).maybeSingle(),
      supabase.from("xp_levels").select("level_no, rank_name, icon").order("level_no", { ascending: true }),
    ]);

    const profileRow = profileRes.data as Record<string, unknown> | null;
    const profileData = (profileRow?.profile_data ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof profileRow?.display_name === "string" && profileRow.display_name.trim()
        ? profileRow.display_name.trim()
        : null) ?? "Membre";

    const verificationStatus = (verificationRes.data as { verification_status?: string } | null)?.verification_status ?? null;
    const isVerified = verificationStatus === "verified" || verificationStatus === "approved";

    const pronouns = (profileData.pronouns as string)?.trim() || null;

    const parseProfilePhotoPath = (): string | null => {
      const photos = (profileRow?.photos ?? {}) as Record<string, unknown>;
      const photosProfile = (photos.profile ?? {}) as Record<string, unknown>;
      const candidates = [
        photos.profile_photo_path,
        photos.profilePhotoPath,
        photosProfile.profile_photo_path,
        photosProfile.profilePhotoPath,
      ];
      return candidates.find((v) => typeof v === "string" && (v as string).trim().length > 0)?.toString().trim() ?? null;
    };
    const profilePhotoPath = parseProfilePhotoPath();

    const looksRaw = profileRow?.looks ?? profileData.looks;
    const parseLooksPaths = (): string[] => {
      if (!looksRaw || typeof looksRaw !== "object") return [];
      if (Array.isArray(looksRaw)) {
        return looksRaw
          .slice(0, 3)
          .map((r) => {
            if (!r || typeof r !== "object") return null;
            const rec = r as Record<string, unknown>;
            const sp = rec.storage_path ?? rec.url ?? rec.path;
            return typeof sp === "string" && sp.trim() ? sp.trim() : null;
          })
          .filter((p): p is string => Boolean(p));
      }
      const rec = looksRaw as Record<string, unknown>;
      return [rec.look1, rec.look2, rec.look3]
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const slot = r as Record<string, unknown>;
          const sp = slot.storage_path ?? slot.url ?? slot.path;
          return typeof sp === "string" && sp.trim() ? sp.trim() : null;
        })
        .filter((p): p is string => Boolean(p));
    };
    const lookPaths = parseLooksPaths();

    const allPaths = [...(profilePhotoPath ? [profilePhotoPath] : []), ...lookPaths];
    const bucket = supabase.storage.from("bucket_focus");
    const getSignedUrl = async (path: string) => {
      const { data: signed } = await bucket.createSignedUrl(path, 60 * 60 * 24);
      return signed?.signedUrl ?? bucket.getPublicUrl(path).data.publicUrl ?? path;
    };

    const photoUrls: string[] = [];
    for (const path of allPaths) {
      try {
        photoUrls.push(await getSignedUrl(path));
      } catch {
        photoUrls.push(bucket.getPublicUrl(path).data.publicUrl ?? path);
      }
    }

    const currentLevel = Number((stateRes.data as { current_level?: number } | null)?.current_level ?? 1) || 1;
    const levels = (levelsRes.data ?? []) as Array<{ level_no: number; rank_name?: string | null; icon?: string | null }>;
    const levelRow = levels.find((l) => l.level_no === currentLevel) ?? levels[0];
    const levelIcon = levelRow?.icon?.trim() || "🌱";
    const levelLabel = levelRow?.rank_name?.trim() || "Nouvelle";

    const usersCreatedAt = (usersRes.data as { created_at?: string } | null)?.created_at ?? null;
    const memberSinceFormatted = formatMemberSince(usersCreatedAt);

    setData({
      displayName,
      pronouns,
      isVerified,
      photoUrls,
      levelIcon,
      levelLabel,
      levelNumber: currentLevel,
      memberSince: memberSinceFormatted,
    });
    setIsLoading(false);
  }, [ownerUserId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, isLoading };
}
