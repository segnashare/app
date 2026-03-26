import type { ItemInfoCardData } from "@/components/item/ItemInfoCard";
import type { ItemViewSlot } from "@/components/item/ItemViewView";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const CONDITION_SCORE_TO_LABEL: Record<string, string> = {
  neuf_etiquette: "Neuf avec étiquette",
  excellent: "Excellent état",
  tres_bon: "Très bon état",
  bon: "Bon état",
  acceptable: "Acceptable",
  degrade: "Dégradé",
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

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

const getImageRatio = (url: string) =>
  new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0 ? img.width / img.height : 1);
    img.onerror = () => resolve(1);
    img.src = url;
  });

async function resolveStoragePreviewUrl(supabase: any, storagePath: string): Promise<string | null> {
  if (isHttpUrl(storagePath)) return storagePath;
  const outs = await Promise.all(
    (["bucket_items", "bucket_focus"] as const).map((bucketId) =>
      supabase.storage
        .from(bucketId)
        .createSignedUrl(storagePath, 60 * 60 * 24)
        .then((r: { data?: { signedUrl?: string } | null }) => r.data?.signedUrl ?? null),
    ),
  );
  return outs.find(Boolean) ?? null;
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
 * Charge la fiche pièce (même forme que `ItemDetailView`) pour l’utilisateur courant.
 * Utilisable pour préchargement depuis /exchange.
 */
export async function fetchItemDetailDataForOwner(itemId: string): Promise<FetchItemDetailResult> {
  if (!itemId.trim()) return { ok: false, kind: "not_found" };

  const supabase = createSupabaseBrowserClient() as any;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, kind: "auth" };

  const { data: itemRow, error: itemError } = await supabase
    .from("items")
    .select(
      "id,title,description,photos,price_points,owner_user_id,status,item_category_id,item_brand_id,item_size_id,item_materiaux_id,item_couleur_id, item_intake(listing_stage,fulfillment_stage,metadata,updated_at), item_outtake(stage,metadata,deleted_at)",
    )
    .eq("id", itemId)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (itemError || !itemRow) return { ok: false, kind: "not_found" };

  const row = itemRow as Record<string, unknown>;
  const categoryId = row.item_category_id as string | null;
  const brandId = row.item_brand_id as string | null;
  const sizeId = row.item_size_id as string | null;
  const materialsId = row.item_materiaux_id as string | null;
  const colorId = row.item_couleur_id as string | null;

  const [categoryRes, brandRes, sizeRes, materialsRes, colorRes, conditionRes] = await Promise.all([
    categoryId ? supabase.from("item_categories").select("name").eq("id", categoryId).maybeSingle() : { data: null },
    brandId ? supabase.from("item_brands").select("label").eq("id", brandId).maybeSingle() : { data: null },
    sizeId ? supabase.from("sizes").select("label").eq("id", sizeId).maybeSingle() : { data: null },
    materialsId ? supabase.from("item_materiaux").select("label").eq("id", materialsId).maybeSingle() : { data: null },
    colorId ? supabase.from("item_couleurs").select("label").eq("id", colorId).maybeSingle() : { data: null },
    supabase
      .from("item_condition_history")
      .select("condition_score")
      .eq("item_id", itemId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const conditionScore = (conditionRes.data as { condition_score?: string } | null)?.condition_score ?? null;
  const conditionLabel = conditionScore ? CONDITION_SCORE_TO_LABEL[conditionScore] ?? conditionScore : "—";

  const categoryLabel = (categoryRes.data as { name?: string } | null)?.name ?? "—";
  const brandLabel = (brandRes.data as { label?: string } | null)?.label ?? "—";
  const sizeLabel = (sizeRes.data as { label?: string } | null)?.label ?? "—";
  const materialsLabel = (materialsRes.data as { label?: string } | null)?.label ?? "—";
  const colorLabel = (colorRes.data as { label?: string } | null)?.label ?? "—";

  const photoEntries = getPhotoEntriesFromJson(row.photos).slice(0, 6);
  const slots: Array<ItemViewSlot | null> = [null, null, null, null, null, null];

  const slotTasks = photoEntries.map(async (entry, index) => {
    const storagePathRaw = entry.storage_path ?? entry.storagePath ?? entry.url ?? entry.photo_url ?? entry.photoUrl;
    const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
    if (!storagePath) return;

    const previewUrl = await resolveStoragePreviewUrl(supabase, storagePath);
    if (!previewUrl) return;

    const position = entry.position && typeof entry.position === "object" ? (entry.position as Record<string, unknown>) : null;
    const offsetRaw = position?.offset && typeof position.offset === "object" ? (position.offset as Record<string, unknown>) : null;
    const offsetX = typeof offsetRaw?.x === "number" ? offsetRaw.x : 0;
    const offsetY = typeof offsetRaw?.y === "number" ? offsetRaw.y : 0;
    const zoom = typeof position?.zoom === "number" ? position.zoom : 1;
    const imageRatio = await getImageRatio(previewUrl);

    slots[index] = {
      dataUrl: previewUrl,
      offset: { x: offsetX, y: offsetY },
      zoom,
      imageRatio,
    };
  });

  await Promise.all(slotTasks);

  const compactedSlots = slots.filter(Boolean);
  const filledSlots: Array<ItemViewSlot | null> = [...compactedSlots, ...Array(6 - compactedSlots.length).fill(null)].slice(0, 6);

  const rawIntake = row.item_intake as unknown;
  const intakeEmb = Array.isArray(rawIntake) ? rawIntake[0] : rawIntake;
  let intake: ItemIntakeSnapshot | null = null;
  if (intakeEmb && typeof intakeEmb === "object") {
    const o = intakeEmb as Record<string, unknown>;
    intake = {
      listing_stage: typeof o.listing_stage === "string" ? o.listing_stage : null,
      fulfillment_stage: typeof o.fulfillment_stage === "string" ? o.fulfillment_stage : null,
      metadata: o.metadata ?? {},
      updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    };
  }

  const rawOuttake = row.item_outtake as unknown;
  const outtakeEmb = Array.isArray(rawOuttake) ? rawOuttake[0] : rawOuttake;
  let outtake: { stage: string | null; deletedAt: string | null; metadata: unknown } | null = null;
  if (outtakeEmb && typeof outtakeEmb === "object") {
    const o = outtakeEmb as Record<string, unknown>;
    outtake = {
      stage: typeof o.stage === "string" ? o.stage : null,
      deletedAt: typeof o.deleted_at === "string" ? o.deleted_at : null,
      metadata: o.metadata ?? {},
    };
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
        ratingValue: "5.0",
        ratingStars: 5,
        size: sizeLabel,
        materials: materialsLabel,
        color: colorLabel,
        brand: brandLabel,
        condition: conditionLabel,
      },
      ownerUserId: row.owner_user_id as string,
    },
  };
}
