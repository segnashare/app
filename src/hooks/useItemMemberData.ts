"use client";

import { useCallback, useEffect, useState } from "react";

import type { ItemMemberPhoto, ItemMemberSectionData } from "@/components/item/ItemMemberSection";
import { parsePhotoTransformRecord, parseUserProfilePhotoPath } from "@/lib/profile/parse-profile-photo-path";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const LOOK_CROP_STAGE_RATIO = 3 / 4;
const PROFILE_CROP_STAGE_RATIO = 1;

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

type PhotoEntryDraft = {
  path: string;
  transformRaw: unknown;
  cropStageRatio: number;
};

function readLookPath(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const sp = rec.storage_path ?? rec.url ?? rec.path;
  return typeof sp === "string" && sp.trim() ? sp.trim() : null;
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

    const photosObj = (profileRow?.photos ?? {}) as Record<string, unknown>;
    const profilePhotoPath = parseUserProfilePhotoPath(profileRow ?? {});

    const photoEntries: PhotoEntryDraft[] = [];
    if (profilePhotoPath) {
      photoEntries.push({
        path: profilePhotoPath,
        transformRaw: photosObj.profile_photo_transform,
        cropStageRatio: PROFILE_CROP_STAGE_RATIO,
      });
    }

    const looksRaw = profileRow?.looks ?? profileData.looks;
    if (Array.isArray(looksRaw)) {
      for (const entry of looksRaw.slice(0, 3)) {
        const path = readLookPath(entry);
        if (!path) continue;
        const rec = entry as Record<string, unknown>;
        photoEntries.push({
          path,
          transformRaw: rec.position,
          cropStageRatio: LOOK_CROP_STAGE_RATIO,
        });
      }
    } else if (looksRaw && typeof looksRaw === "object") {
      const rec = looksRaw as Record<string, unknown>;
      for (const key of ["look1", "look2", "look3"] as const) {
        const entry = rec[key];
        const path = readLookPath(entry);
        if (!path) continue;
        const lookRec = entry as Record<string, unknown>;
        photoEntries.push({
          path,
          transformRaw: lookRec.position,
          cropStageRatio: LOOK_CROP_STAGE_RATIO,
        });
      }
    }

    const getSignedUrl = async (path: string) => {
      const signed = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24, {
        explicitBucket: "bucket_focus",
      });
      if (signed) return signed;
      const normalized = path.replace(/^\/+/, "").replace(/^bucket_focus\//i, "");
      return supabase.storage.from("bucket_focus").getPublicUrl(normalized).data.publicUrl ?? path;
    };

    const getImageRatio = (url: string) =>
      new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.width > 0 && img.height > 0 ? img.width / img.height : 1);
        img.onerror = () => resolve(1);
        img.src = url;
      });

    const photos: ItemMemberPhoto[] = [];
    for (const entry of photoEntries) {
      try {
        const url = await getSignedUrl(entry.path);
        const transform = parsePhotoTransformRecord(entry.transformRaw);
        photos.push({
          url,
          offset: transform.offset,
          zoom: transform.zoom,
          imageRatio: await getImageRatio(url),
          cropStageRatio: entry.cropStageRatio,
        });
      } catch {
        try {
          const normalized = entry.path.replace(/^\/+/, "").replace(/^bucket_focus\//i, "");
          const url = supabase.storage.from("bucket_focus").getPublicUrl(normalized).data.publicUrl ?? entry.path;
          const transform = parsePhotoTransformRecord(entry.transformRaw);
          photos.push({
            url,
            offset: transform.offset,
            zoom: transform.zoom,
            imageRatio: await getImageRatio(url),
            cropStageRatio: entry.cropStageRatio,
          });
        } catch {
          /* ignore broken photo */
        }
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
      photos,
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
