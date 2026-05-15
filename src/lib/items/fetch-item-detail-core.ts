/* eslint-disable @typescript-eslint/no-explicit-any -- même chaîne PostgREST côté navigateur (SSR/client). */
import type { ItemInfoCardData } from "@/components/item/ItemInfoCard";
import type { ItemViewSlot } from "@/components/item/ItemViewView";
import { formatItemCustomBrandLabel, ITEM_BRAND_AUTRE_SLUG } from "@/lib/items/format-item-custom-brand-label";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";

const CONDITION_SCORE_TO_LABEL: Record<string, string> = {
  neuf_etiquette: "Neuf avec étiquette",
  excellent: "Excellent état",
  tres_bon: "Très bon état",
  bon: "Bon état",
  acceptable: "Acceptable",
  degrade: "Dégradé",
};

/** Aligné sur les cadres fiche / skeleton (`aspect-[3/4]`). Évite un chargement d’image par slot pour mesurer le ratio. */
const DEFAULT_SLOT_IMAGE_RATIO = 3 / 4;

function getPhotoEntriesFromJson(photosRaw: unknown): Array<Record<string, unknown>> {
  if (!photosRaw || typeof photosRaw !== "object") return [];
  const photos = photosRaw as Record<string, unknown>;
  return Object.entries(photos)
    .filter(([key, value]) => key.toLowerCase().startsWith("photo") && value && typeof value === "object")
    .sort(([keyA], [keyB]) => {
      const indexA = Number(keyA.toLowerCase().replace("photo", ""));
      const indexB = Number(keyB.toLowerCase().replace("photo", ""));
      if (Number.isNaN(indexA) || Number.isNaN(indexB)) return keyA.localeCompare(keyB);
      return indexA - indexB;
    })
    .map(([, value]) => value as Record<string, unknown>);
}

async function resolveStoragePreviewUrl(supabase: any, storagePath: string, photoEntry: Record<string, unknown>): Promise<string | null> {
  const explicit =
    (typeof photoEntry.bucket_id === "string" && photoEntry.bucket_id) ||
    (typeof photoEntry.storage_bucket === "string" && photoEntry.storage_bucket) ||
    (typeof photoEntry.bucket === "string" && photoEntry.bucket) ||
    null;
  return createSignedUrlForStoragePath(
    supabase,
    storagePath,
    60 * 60 * 24,
    explicit ? { explicitBucket: explicit } : undefined,
  );
}

async function fetchArchivedExchangeCountForItem(supabase: any, itemId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_item_exchange_count", { p_item_id: itemId });
    if (error) return 0;
    return Math.max(0, Math.floor(Number(data ?? 0)));
  } catch {
    return 0;
  }
}

type FeedbackRatingSummary = {
  average: number | null;
  count: number;
};

async function fetchItemFeedbackSummary(supabase: any, itemId: string): Promise<FeedbackRatingSummary> {
  try {
    const { data, error } = await supabase.rpc("get_feedback_rating_summary", {
      p_target_type: "item",
      p_item_id: itemId,
      p_target_user_id: null,
    });
    if (error || !data || typeof data !== "object") return { average: null, count: 0 };
    const payload = data as { average?: number | string | null; count?: number | string | null };
    const average = Number(payload.average);
    const count = Math.max(0, Math.floor(Number(payload.count ?? 0)));
    return {
      average: Number.isFinite(average) && count > 0 ? average : null,
      count,
    };
  } catch {
    return { average: null, count: 0 };
  }
}

export type ItemIntakeSnapshot = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
  updated_at: string | null;
};

export type ItemDetailPayload = {
  title: string;
  description: string;
  status: string;
  outtake: {
    stage: string | null;
    deletedAt: string | null;
    metadata: unknown;
  } | null;
  slots: Array<ItemViewSlot | null>;
  intake: ItemIntakeSnapshot | null;
  infoCard: ItemInfoCardData;
  ownerUserId: string;
};

export type FetchItemDetailResult =
  | { ok: true; payload: ItemDetailPayload }
  | { ok: false; kind: "auth" | "not_found" };

/**
 * Charge la fiche pièce pour un utilisateur connu (session déjà résolue côté appelant).
 * Même logique RLS que le client navigateur.
 */
export async function fetchItemDetailPayloadForUser(
  supabase: any,
  userId: string,
  itemId: string,
): Promise<FetchItemDetailResult> {
  const trimmed = itemId.trim();
  if (!trimmed) return { ok: false, kind: "not_found" };
  if (!userId.trim()) return { ok: false, kind: "auth" };

  const { data: itemRow, error: itemError } = await supabase
    .from("items")
    .select(
      "id,title,description,photos,price_points,owner_user_id,status,item_category_id,item_brand_id,item_custom_brand_label,item_size_id,item_materiaux_id,item_couleur_id",
    )
    .eq("id", trimmed)
    .is("deleted_at", null)
    .maybeSingle();

  if (itemError || !itemRow) return { ok: false, kind: "not_found" };

  const row = itemRow as Record<string, unknown>;
  const ownerUserId = String(row.owner_user_id ?? "");
  const isOwner = ownerUserId === userId;
  const brandId = row.item_brand_id as string | null;
  const sizeId = row.item_size_id as string | null;
  const materialsId = row.item_materiaux_id as string | null;
  const colorId = row.item_couleur_id as string | null;

  const [brandRes, sizeRes, materialsRes, colorRes, conditionRes, likesRes, exchangeCount, itemRatingSummary] =
    await Promise.all([
    brandId ? supabase.from("item_brands").select("label,slug").eq("id", brandId).maybeSingle() : { data: null },
    sizeId ? supabase.from("sizes").select("label").eq("id", sizeId).maybeSingle() : { data: null },
    materialsId ? supabase.from("item_materiaux").select("label").eq("id", materialsId).maybeSingle() : { data: null },
    colorId ? supabase.from("item_couleurs").select("label").eq("id", colorId).maybeSingle() : { data: null },
    supabase
      .from("item_condition_history")
      .select("condition_score")
      .eq("item_id", trimmed)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("item_favorites")
      .select("id", { count: "exact", head: true })
      .eq("item_id", trimmed)
      .is("deleted_at", null),
    fetchArchivedExchangeCountForItem(supabase, trimmed),
    fetchItemFeedbackSummary(supabase, trimmed),
  ]);

  const conditionScore = (conditionRes.data as { condition_score?: string } | null)?.condition_score ?? null;
  const conditionLabel = conditionScore ? CONDITION_SCORE_TO_LABEL[conditionScore] ?? conditionScore : "—";
  const likeCount = typeof likesRes.count === "number" ? likesRes.count : 0;

  const customBrand = typeof row.item_custom_brand_label === "string" ? row.item_custom_brand_label.trim() : "";
  const brandRow = brandRes.data as { label?: string | null; slug?: string | null } | null;
  const brandFallback = brandRow?.label?.trim() || "—";
  const rawTitle = typeof row.title === "string" ? row.title.trim() : "";
  const titleAsBrandHint = rawTitle ? formatItemCustomBrandLabel(rawTitle) : "";
  const slugLower = brandRow?.slug?.trim().toLowerCase() ?? "";
  const isAutreBrand =
    slugLower === ITEM_BRAND_AUTRE_SLUG || brandFallback.trim().toLowerCase() === "autre";
  const brandLabel = customBrand
    ? customBrand
    : isAutreBrand && titleAsBrandHint
      ? titleAsBrandHint
      : brandFallback;
  const rawSizeLabel = (sizeRes.data as { label?: string } | null)?.label?.trim();
  const sizeLabel = rawSizeLabel ? rawSizeLabel : "";
  const materialsLabel = (materialsRes.data as { label?: string } | null)?.label ?? "—";
  const colorLabel = (colorRes.data as { label?: string } | null)?.label ?? "—";

  const photoEntries = getPhotoEntriesFromJson(row.photos).slice(0, 6);
  const slots: Array<ItemViewSlot | null> = [null, null, null, null, null, null];

  const slotTasks = photoEntries.map(async (entry, index) => {
    const storagePathRaw = entry.storage_path ?? entry.storagePath ?? entry.url ?? entry.photo_url ?? entry.photoUrl;
    const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
    if (!storagePath) return;

    const previewUrl = await resolveStoragePreviewUrl(supabase, storagePath, entry);
    if (!previewUrl) return;

    const position = entry.position && typeof entry.position === "object" ? (entry.position as Record<string, unknown>) : null;
    const offsetRaw = position?.offset && typeof position.offset === "object" ? (position.offset as Record<string, unknown>) : null;
    const offsetX = typeof offsetRaw?.x === "number" ? offsetRaw.x : 0;
    const offsetY = typeof offsetRaw?.y === "number" ? offsetRaw.y : 0;
    const zoom = typeof position?.zoom === "number" ? position.zoom : 1;

    slots[index] = {
      dataUrl: previewUrl,
      offset: { x: offsetX, y: offsetY },
      zoom,
      imageRatio: DEFAULT_SLOT_IMAGE_RATIO,
    };
  });

  await Promise.all(slotTasks);

  const compactedSlots = slots.filter(Boolean);
  const filledSlots: Array<ItemViewSlot | null> = [...compactedSlots, ...Array(6 - compactedSlots.length).fill(null)].slice(0, 6);

  let intake: ItemIntakeSnapshot | null = null;
  let outtake: { stage: string | null; deletedAt: string | null; metadata: unknown } | null = null;

  if (isOwner) {
    const [intakeRes, outtakeRes] = await Promise.all([
      supabase.from("item_intake").select("listing_stage,fulfillment_stage,metadata,updated_at").eq("item_id", trimmed).maybeSingle(),
      supabase.from("item_outtake").select("stage,metadata,deleted_at").eq("item_id", trimmed).maybeSingle(),
    ]);

    const intakeEmb = intakeRes.data as Record<string, unknown> | null;
    if (intakeEmb && typeof intakeEmb === "object") {
      intake = {
        listing_stage: typeof intakeEmb.listing_stage === "string" ? intakeEmb.listing_stage : null,
        fulfillment_stage: typeof intakeEmb.fulfillment_stage === "string" ? intakeEmb.fulfillment_stage : null,
        metadata: intakeEmb.metadata ?? {},
        updated_at: typeof intakeEmb.updated_at === "string" ? intakeEmb.updated_at : null,
      };
    }

    const o = outtakeRes.data as Record<string, unknown> | null;
    if (o && typeof o === "object") {
      outtake = {
        stage: typeof o.stage === "string" ? o.stage : null,
        deletedAt: typeof o.deleted_at === "string" ? o.deleted_at : null,
        metadata: o.metadata ?? {},
      };
    }
  }

  return {
    ok: true,
    payload: {
      title: (row.title as string)?.trim() || "Sans titre",
      description: (row.description as string)?.trim() || "",
      status: (row.status as string) ?? "",
      outtake,
      slots: filledSlots,
      intake,
      infoCard: {
        pricePoints: row.price_points != null ? Number(row.price_points) : null,
        likeCount,
        exchangeCount,
        itemRatingAverage: itemRatingSummary.average,
        itemRatingCount: itemRatingSummary.count,
        ratingValue: "5.0",
        ratingStars: 5,
        size: sizeLabel,
        materials: materialsLabel,
        color: colorLabel,
        brand: brandLabel,
        condition: conditionLabel,
      },
      ownerUserId,
    },
  };
}
