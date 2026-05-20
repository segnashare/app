import {
  createSignedUrlsForStoragePaths,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";
import type { ItemFeedbackDisplayRow, ItemWornPhotoDisplayRow } from "@/lib/feedback/item-feedback-types";

type SupabaseRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function fetchItemFeedbacksForDisplay(
  supabase: SupabaseRpc,
  itemId: string,
): Promise<ItemFeedbackDisplayRow[]> {
  const { data, error } = await supabase.rpc("list_item_feedbacks_for_display", {
    p_item_id: itemId,
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row) => {
      const r = row as Record<string, unknown>;
      const rating = Number(r.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
      return {
        id: String(r.id ?? ""),
        rating,
        comment: typeof r.comment === "string" && r.comment.trim() ? r.comment.trim() : null,
        reviewerDisplayName:
          typeof r.reviewer_display_name === "string" && r.reviewer_display_name.trim()
            ? r.reviewer_display_name.trim()
            : "Membre Segna",
        createdAt: typeof r.created_at === "string" ? r.created_at : "",
      };
    })
    .filter((row): row is ItemFeedbackDisplayRow => Boolean(row?.id));
}

export async function fetchItemWornPhotosForDisplay(
  supabase: SupabaseRpc & StorageSignClient,
  itemId: string,
): Promise<ItemWornPhotoDisplayRow[]> {
  const { data, error } = await supabase.rpc("list_item_worn_photo_paths", {
    p_item_id: itemId,
  });
  if (error || !Array.isArray(data)) return [];

  const rows = data
    .map((row) => {
      const r = row as Record<string, unknown>;
      const storagePath = typeof r.storage_path === "string" ? r.storage_path.trim() : "";
      if (!storagePath) return null;
      return {
        feedbackId: String(r.feedback_id ?? ""),
        storagePath,
        previewUrl: null as string | null,
        createdAt: typeof r.created_at === "string" ? r.created_at : "",
      };
    })
    .filter((row): row is ItemWornPhotoDisplayRow => Boolean(row?.storagePath));

  if (rows.length === 0) return [];

  const signed = await createSignedUrlsForStoragePaths(
    supabase,
    rows.map((r) => r.storagePath),
    3600,
  );

  return rows.map((row) => ({
    ...row,
    previewUrl: signed.get(row.storagePath) ?? null,
  }));
}
