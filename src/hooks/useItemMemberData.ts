"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ItemMemberSectionData } from "@/components/item/ItemMemberSection";

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

    const [profileRes, verificationRes] = await Promise.all([
      supabase.from("user_profiles").select("display_name, profile_data, looks").eq("user_id", ownerUserId).maybeSingle(),
      supabase.from("user_identity_verifications").select("verification_status").eq("user_id", ownerUserId).maybeSingle(),
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

    const bucket = supabase.storage.from("bucket_focus");
    const getSignedUrl = async (path: string) => {
      const { data: signed } = await bucket.createSignedUrl(path, 60 * 60 * 24);
      return signed?.signedUrl ?? bucket.getPublicUrl(path).data.publicUrl ?? path;
    };

    const photoUrls: string[] = [];
    for (const path of lookPaths) {
      try {
        photoUrls.push(await getSignedUrl(path));
      } catch {
        photoUrls.push(bucket.getPublicUrl(path).data.publicUrl ?? path);
      }
    }

    setData({
      displayName,
      pronouns,
      isVerified,
      photoUrls,
    });
    setIsLoading(false);
  }, [ownerUserId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, isLoading };
}
