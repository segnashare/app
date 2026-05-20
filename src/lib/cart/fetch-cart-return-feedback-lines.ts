import type { CartReturnFeedbackLineState } from "@/lib/feedback/item-feedback-types";
import { isCartReturnEligibleForItemFeedback } from "@/lib/cart/cart-return-feedback-eligibility";
import type { MemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

function parseWornPhotoPaths(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const paths = (metadata as { worn_photo_paths?: unknown }).worn_photo_paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 3);
}

export async function fetchCartReturnFeedbackLines(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  detail: MemberCartOrderDetail,
): Promise<{ eligible: boolean; lines: CartReturnFeedbackLineState[]; allSubmitted: boolean }> {
  const returnStatus = detail.returnShipment?.status ?? null;
  const eligible = isCartReturnEligibleForItemFeedback(returnStatus);
  if (!eligible || detail.lines.length === 0) {
    return { eligible, lines: [], allSubmitted: false };
  }

  const cartItemIds = detail.lines.map((l) => l.id);
  const { data: existingRows, error } = await supabase
    .from("feedbacks")
    .select("cart_item_id,rating,comment,metadata")
    .eq("target_type", "item")
    .eq("reviewer_user_id", userId)
    .is("deleted_at", null)
    .in("cart_item_id", cartItemIds);

  if (error) {
    return {
      eligible,
      lines: detail.lines.map((line) => ({
        cartItemId: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        brand: line.brand,
        photoUrl: line.photoUrl,
        existingRating: null,
        existingComment: null,
        existingWornPhotos: [],
      })),
      allSubmitted: false,
    };
  }

  const allPaths: string[] = [];
  const byCartItem = new Map<
    string,
    { rating: number | null; comment: string | null; wornPaths: string[] }
  >();

  for (const row of (existingRows ?? []) as Array<Record<string, unknown>>) {
    const cartItemId = String(row.cart_item_id ?? "");
    if (!cartItemId) continue;
    const ratingRaw = Number(row.rating);
    const wornPaths = parseWornPhotoPaths(row.metadata);
    for (const p of wornPaths) allPaths.push(p);
    byCartItem.set(cartItemId, {
      rating: Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null,
      comment: typeof row.comment === "string" && row.comment.trim() ? row.comment.trim() : null,
      wornPaths,
    });
  }

  const signed = allPaths.length > 0 ? await createSignedUrlsForStoragePaths(supabase, allPaths, 3600) : new Map();

  const lines: CartReturnFeedbackLineState[] = detail.lines.map((line) => {
    const existing = byCartItem.get(line.id);
    return {
      cartItemId: line.id,
      itemId: line.itemId,
      itemName: line.itemName,
      brand: line.brand,
      photoUrl: line.photoUrl,
      existingRating: existing?.rating ?? null,
      existingComment: existing?.comment ?? null,
      existingWornPhotos: (existing?.wornPaths ?? []).map((storagePath, index) => ({
        id: `${line.id}-${index}`,
        storagePath,
        previewUrl: signed.get(storagePath) ?? null,
      })),
    };
  });

  const allSubmitted = lines.every((l) => l.existingRating != null);

  return { eligible, lines, allSubmitted };
}
