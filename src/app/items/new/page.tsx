"use client";

import Link from "next/link";
import { Montserrat, Playfair_Display } from "next/font/google";
import { ChevronRight, GripVertical, Image as ImageIcon, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, TouchEvent } from "react";

import { ItemViewView } from "@/components/item/ItemViewView";
import { Input } from "@/components/ui/Input";
import { AppLoadingScreen } from "@/components/ui/AppLoadingScreen";
import {
  fileToDataUrl,
  readPhotoModifyDraft,
  removePhotoModifyDraft,
  savePhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

const INFO_LINKS = [
  { key: "color", label: "Couleur", href: "/items/new/color" },
  { key: "category", label: "Catégorie", href: "/items/new/category" },
  { key: "size", label: "Taille", href: "/items/new/size" },
  { key: "brand", label: "Marque", href: "/items/new/brand" },
  { key: "condition", label: "État", href: "/items/new/condition" },
  { key: "materials", label: "Matériaux", href: "/items/new/materials" },
] as const;

type ItemPhotoSlot = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  storagePath?: string;
  imageRatio: number;
  offset: { x: number; y: number };
  zoom: number;
};

function compactSlotsLeft(next: Array<ItemPhotoSlot | null>): Array<ItemPhotoSlot | null> {
  const filled: ItemPhotoSlot[] = [];
  for (const slot of next) {
    if (slot) filled.push(slot);
  }
  return [...filled, ...Array(next.length - filled.length).fill(null)];
}

const ACTIVE_DRAFT_ID_STORAGE_KEY = "segna:new-item:active-draft-id";
const ITEM_SLOTS_DRAFT_STORAGE_KEY = "segna:new-item:slots-draft";
const ITEM_TEXT_DRAFT_STORAGE_KEY = "segna:new-item:text-draft";

const CONDITION_LABEL_TO_SCORE: Record<string, string> = {
  "Neuf avec étiquette": "neuf_etiquette",
  "Excellent état": "excellent",
  "Très bon état": "tres_bon",
  "Bon état": "bon",
  Acceptable: "acceptable",
  Dégradé: "degrade",
};

async function upsertDraftCondition(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  itemId: string,
  userId: string,
  conditionScore: string,
  defectNotes: string | null,
): Promise<{ error: Error | null }> {
  await supabase.from("item_condition_history").delete().eq("item_id", itemId).eq("status", "draft");
  const { error } = await supabase.from("item_condition_history").insert({
    item_id: itemId,
    source: "owner_announced",
    condition_score: conditionScore,
    defect_notes: defectNotes,
    status: "draft",
    recorded_by_user_id: userId,
  });
  return { error: error ? new Error(error.message) : null };
}
const CONDITION_SCORE_TO_LABEL: Record<string, string> = {
  neuf_etiquette: "Neuf avec étiquette",
  excellent: "Excellent état",
  tres_bon: "Très bon état",
  bon: "Bon état",
  acceptable: "Acceptable",
  degrade: "Dégradé",
};
const ITEM_STAGE_RATIO = 1;

const getImageRatio = (dataUrl: string) =>
  new Promise<number>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (image.width > 0 && image.height > 0) {
        resolve(image.width / image.height);
        return;
      }
      resolve(1);
    };
    image.onerror = () => resolve(1);
    image.src = dataUrl;
  });

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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeDraftTitle(value: string | null | undefined): string {
  const title = (value ?? "").trim();
  if (!title) return "";
  const normalized = title.toLowerCase();
  if (normalized === "nouvelle pièce" || normalized === "nouvelle piece" || normalized === "empty") return "";
  return title;
}

export default function NewItemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedItemId = searchParams.get("itemId")?.trim() || null;
  const forceFreshDraft = searchParams.get("fresh") === "1";
  const initialTitleFromParams = searchParams.get("title") ?? "";
  const initialDescriptionFromParams = searchParams.get("description") ?? "";
  const supabaseRef = useRef(createSupabaseBrowserClient() as any);
  const supabase = supabaseRef.current;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSlotRef = useRef(0);
  const pendingSlotRef = useRef<number | null>(null);
  const handledPhotoModifyIdsRef = useRef<Set<string>>(new Set());
  const [slots, setSlots] = useState<Array<ItemPhotoSlot | null>>([null, null, null, null, null, null]);
  const [mode, setMode] = useState<"edit" | "view">("edit");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; index: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [itemTitle, setItemTitle] = useState(() => initialTitleFromParams);
  const [description, setDescription] = useState(() => initialDescriptionFromParams);
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [isInitializingDraft, setIsInitializingDraft] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [isKeepingDraft, setIsKeepingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasHydratedSlots, setHasHydratedSlots] = useState(false);
  const [itemPricePoints, setItemPricePoints] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const formId = "new-item-form";
  const filledPhotosCount = slots.filter(Boolean).length;
  const completionScore = Math.round(
    Math.min(100, (itemTitle.trim().length > 0 ? 35 : 0) + (description.trim().length > 0 ? 25 : 0) + Math.min(40, filledPhotosCount * 10)),
  );
  const infoValues = {
    category: searchParams.get("category") ?? "-",
    brand: searchParams.get("brand") ?? "-",
    size: searchParams.get("size") ?? "-",
    condition: searchParams.get("condition") ?? "-",
    materials: searchParams.get("materials") ?? "-",
    color: searchParams.get("color") ?? "-",
  };
  const categoryId = searchParams.get("categoryId")?.trim() || null;
  const brandId = searchParams.get("brandId")?.trim() || null;
  const sizeId = searchParams.get("sizeId")?.trim() || null;
  const [categorySizeScope, setCategorySizeScope] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId) {
      setCategorySizeScope(null);
      return;
    }
    let isUnmounted = false;
    void (async () => {
      const { data } = await supabase.from("item_categories").select("size_scope").eq("id", categoryId).maybeSingle();
      if (isUnmounted) return;
      setCategorySizeScope((data as { size_scope?: string | null } | null)?.size_scope ?? null);
    })();
    return () => {
      isUnmounted = true;
    };
  }, [categoryId, supabase]);

  const showSizeLink = Boolean(categoryId && categorySizeScope && categorySizeScope !== "none");

  const infoIds = {
    ...(categoryId ? { item_category_id: categoryId } : {}),
    ...(brandId ? { item_brand_id: brandId } : {}),
    ...(sizeId ? { item_size_id: sizeId } : {}),
  };
  const canSubmit = completionScore >= 100 && !!draftItemId && !isInitializingDraft && !isSubmitting;

  useEffect(() => {
    if (!forceFreshDraft) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("fresh");
    const query = params.toString();
    router.replace(query ? `/items/new?${query}` : "/items/new");
  }, [forceFreshDraft, router, searchParams]);

  useEffect(() => {
    void supabase.auth.getUser().then((res: { data: { user?: { id: string } | null } }) => {
      const uid = res.data.user?.id;
      if (uid) setCurrentUserId(uid);
    });
  }, [supabase]);

  useEffect(() => {
    let isUnmounted = false;

    const ensureDraft = async () => {
      setErrorMessage(null);
      setIsInitializingDraft(true);
      if (!requestedItemId && forceFreshDraft) {
        sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
        sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
        setSlots([null, null, null, null, null, null]);
      }
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (isUnmounted) return;
      if (userError || !user) {
        setErrorMessage("Session invalide.");
        setIsInitializingDraft(false);
        return;
      }

      if (requestedItemId) {
        const existingDraftId = sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
        if (existingDraftId && existingDraftId !== requestedItemId) {
          sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
          setSlots([null, null, null, null, null, null]);
        }

        sessionStorage.setItem(ACTIVE_DRAFT_ID_STORAGE_KEY, requestedItemId);
        setDraftItemId(requestedItemId);

        const { data: itemData, error: itemError } = await supabase
          .from("items")
          .select("id,title,description,photos,item_category_id,item_brand_id,item_size_id,price_points")
          .eq("id", requestedItemId)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle();

        if (isUnmounted) return;
        if (itemError || !itemData) {
          setDraftItemId(requestedItemId);
          let nextTitle = searchParams.get("title") ?? initialTitleFromParams;
          let nextDescription = searchParams.get("description") ?? initialDescriptionFromParams;
          try {
            const rawLocalText = sessionStorage.getItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
            if (rawLocalText) {
              const parsed = JSON.parse(rawLocalText) as { itemId?: string; title?: string; description?: string };
              if (parsed?.itemId === requestedItemId) {
                nextTitle = parsed.title ?? nextTitle;
                nextDescription = parsed.description ?? nextDescription;
              }
            }
          } catch {
            // Ignore malformed local text draft.
          }
          setItemTitle(nextTitle);
          setDescription(nextDescription);
          try {
            const rawLocalSlots = sessionStorage.getItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
            if (rawLocalSlots) {
              const parsedLocalSlots = JSON.parse(rawLocalSlots) as Array<ItemPhotoSlot | null>;
              if (Array.isArray(parsedLocalSlots) && parsedLocalSlots.length === 6) {
                setSlots(compactSlotsLeft(parsedLocalSlots));
              }
            }
          } catch {
            // Ignore malformed local draft.
          }
          const params = new URLSearchParams(searchParams.toString());
          params.set("itemId", requestedItemId);
          if (!params.get("title") && nextTitle) params.set("title", nextTitle);
          if (!params.get("description") && nextDescription) params.set("description", nextDescription);
          router.replace(`/items/new?${params.toString()}`);
          setIsInitializingDraft(false);
          return;
        }

        let nextTitle = normalizeDraftTitle(itemData.title);
        let nextDescription = itemData.description ?? "";

        try {
          const rawLocalText = sessionStorage.getItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
          if (rawLocalText) {
            const parsed = JSON.parse(rawLocalText) as { itemId?: string; title?: string; description?: string };
            if (parsed?.itemId === requestedItemId) {
              nextTitle = parsed.title ?? nextTitle;
              nextDescription = parsed.description ?? nextDescription;
            }
          }
        } catch {
          // Ignore malformed local text draft.
        }

        setItemTitle(nextTitle);
        setDescription(nextDescription);
        setItemPricePoints(
          typeof (itemData as { price_points?: number | null }).price_points === "number"
            ? (itemData as { price_points: number }).price_points
            : null,
        );

        const params = new URLSearchParams(searchParams.toString());
        params.set("itemId", requestedItemId);
        if (!params.get("title") && nextTitle) params.set("title", nextTitle);
        if (!params.get("description") && nextDescription) params.set("description", nextDescription);

        if (!params.get("categoryId") && itemData.item_category_id) {
          const { data: catRow } = await supabase
            .from("item_categories")
            .select("name")
            .eq("id", itemData.item_category_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (catRow) {
            params.set("categoryId", itemData.item_category_id);
            params.set("category", (catRow as { name?: string }).name ?? "");
          }
        }
        if (!params.get("brandId") && itemData.item_brand_id) {
          const { data: brandRow } = await supabase
            .from("item_brands")
            .select("label")
            .eq("id", itemData.item_brand_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (brandRow) {
            params.set("brandId", itemData.item_brand_id);
            params.set("brand", (brandRow as { label?: string }).label ?? "");
          }
        }
        if (!params.get("sizeId") && itemData.item_size_id) {
          const { data: sizeRow } = await supabase
            .from("sizes")
            .select("code,label")
            .eq("id", itemData.item_size_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (sizeRow) {
            const s = sizeRow as { code?: string; label?: string | null };
            params.set("sizeId", itemData.item_size_id);
            params.set("size", s.label ?? (s.code?.includes(":") ? s.code.split(":")[1] ?? s.code : s.code ?? ""));
          }
        }
        if (!params.get("condition")) {
          const { data: condRow } = await supabase
            .from("item_condition_history")
            .select("condition_score,defect_notes")
            .eq("item_id", requestedItemId)
            .eq("status", "draft")
            .maybeSingle();
          if (isUnmounted) return;
          if (condRow) {
            const c = condRow as { condition_score?: string; defect_notes?: string | null };
            const label = c.condition_score ? CONDITION_SCORE_TO_LABEL[c.condition_score] ?? c.condition_score : "";
            if (label) params.set("condition", label);
            if (c.defect_notes?.trim()) params.set("conditionDetails", c.defect_notes.trim());
          }
        }

        router.replace(`/items/new?${params.toString()}`);

        let hasLocalSlotsDraft = false;
        try {
          const rawLocalSlots = sessionStorage.getItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
          if (rawLocalSlots) {
            const parsedLocalSlots = JSON.parse(rawLocalSlots) as Array<ItemPhotoSlot | null>;
            if (Array.isArray(parsedLocalSlots) && parsedLocalSlots.length === 6) {
              const compactedLocalSlots = compactSlotsLeft(parsedLocalSlots);
              hasLocalSlotsDraft = compactedLocalSlots.some(Boolean);
              if (hasLocalSlotsDraft) {
                setSlots(compactedLocalSlots);
              }
            }
          }
        } catch {
          // Ignore malformed local draft.
        }

        if (hasLocalSlotsDraft) {
          setIsInitializingDraft(false);
          return;
        }

        const photoEntries = getPhotoEntriesFromJson(itemData.photos).slice(0, 6);
        const nextSlots: Array<ItemPhotoSlot | null> = [null, null, null, null, null, null];

        for (let index = 0; index < photoEntries.length; index += 1) {
          const row = photoEntries[index];
          const storagePathRaw = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
          const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
          if (!storagePath) continue;

          let previewUrl: string | null = null;
          if (isHttpUrl(storagePath)) {
            previewUrl = storagePath;
          } else {
            for (const bucketId of ["bucket_items", "bucket_focus"]) {
              const { data } = await supabase.storage.from(bucketId).createSignedUrl(storagePath, 60 * 60 * 24);
              if (data?.signedUrl) {
                previewUrl = data.signedUrl;
                break;
              }
            }
          }
          if (!previewUrl) continue;

          const position = row.position && typeof row.position === "object" ? (row.position as Record<string, unknown>) : null;
          const offsetRaw = position?.offset && typeof position.offset === "object" ? (position.offset as Record<string, unknown>) : null;
          const offsetX = typeof offsetRaw?.x === "number" ? offsetRaw.x : 0;
          const offsetY = typeof offsetRaw?.y === "number" ? offsetRaw.y : 0;
          const zoom = typeof position?.zoom === "number" ? position.zoom : 1;
          const imageRatio = await getImageRatio(previewUrl);

          nextSlots[index] = {
            dataUrl: previewUrl,
            fileName: `photo_${index + 1}.jpg`,
            mimeType: "image/jpeg",
            storagePath,
            imageRatio,
            offset: { x: offsetX, y: offsetY },
            zoom,
          };
        }

        if (!isUnmounted) {
          setSlots(compactSlotsLeft(nextSlots));
        }
        setIsInitializingDraft(false);
        return;
      }

      const existingDraftId = sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
      if (existingDraftId && !forceFreshDraft) {
        setDraftItemId(existingDraftId);
        const { data: existingItemData, error: existingItemError } = await supabase
          .from("items")
          .select("title,description,price_points")
          .eq("id", existingDraftId)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (isUnmounted) return;
        let nextTitle = initialTitleFromParams;
        let nextDescription = initialDescriptionFromParams;
        if (existingItemData) {
          nextTitle = normalizeDraftTitle(existingItemData.title);
          nextDescription = existingItemData.description ?? "";
        }
        try {
          const rawLocalText = sessionStorage.getItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
          if (rawLocalText) {
            const parsed = JSON.parse(rawLocalText) as { itemId?: string; title?: string; description?: string };
            if (parsed?.itemId === existingDraftId) {
              nextTitle = parsed.title ?? nextTitle;
              nextDescription = parsed.description ?? nextDescription;
            }
          }
        } catch {
          // Ignore malformed local text draft.
        }
        setItemTitle(nextTitle);
        setDescription(nextDescription);
        setItemPricePoints(
          existingItemData && typeof (existingItemData as { price_points?: number | null }).price_points === "number"
            ? (existingItemData as { price_points: number }).price_points
            : null,
        );
        setIsInitializingDraft(false);
        return;
      }

      sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
      setSlots([null, null, null, null, null, null]);
      setItemTitle(initialTitleFromParams);
      setDescription(initialDescriptionFromParams);
      setItemPricePoints(null);
      const nextDraftId = crypto.randomUUID();
      sessionStorage.setItem(ACTIVE_DRAFT_ID_STORAGE_KEY, nextDraftId);
      setDraftItemId(nextDraftId);
      setIsInitializingDraft(false);
    };

    void ensureDraft();
    return () => {
      isUnmounted = true;
    };
  }, [forceFreshDraft, initialDescriptionFromParams, initialTitleFromParams, requestedItemId, supabase]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
      if (!raw) {
        setHasHydratedSlots(true);
        return;
      }
      const parsed = JSON.parse(raw) as Array<ItemPhotoSlot | null>;
      if (Array.isArray(parsed) && parsed.length === 6) {
        setSlots(compactSlotsLeft(parsed));
      }
    } catch {
      // Ignore malformed local draft.
    }
    setHasHydratedSlots(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedSlots) return;
    try {
      sessionStorage.setItem(ITEM_SLOTS_DRAFT_STORAGE_KEY, JSON.stringify(slots));
    } catch {
      // Best effort only.
    }
  }, [hasHydratedSlots, slots]);

  useEffect(() => {
    if (!draftItemId || isInitializingDraft) return;
    try {
      sessionStorage.setItem(
        ITEM_TEXT_DRAFT_STORAGE_KEY,
        JSON.stringify({
          itemId: draftItemId,
          title: itemTitle,
          description,
        }),
      );
    } catch {
      // Best effort only.
    }
  }, [description, draftItemId, isInitializingDraft, itemTitle]);

  const conditionParam = searchParams.get("condition")?.trim() || null;
  const conditionDetailsParam = searchParams.get("conditionDetails")?.trim() || null;

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    if (handledPhotoModifyIdsRef.current.has(modifiedId)) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || draft.source !== "item" || draft.status !== "confirmed") return;
    const slotFromDraft = typeof draft.slot === "number" && draft.slot >= 0 && draft.slot <= 5 ? draft.slot : null;
    const resolvedSlot = slotFromDraft ?? pendingSlotRef.current;
    if (resolvedSlot == null || resolvedSlot < 0 || resolvedSlot > 5) return;
    handledPhotoModifyIdsRef.current.add(modifiedId);

    void (async () => {
      const imageRatio = await getImageRatio(draft.dataUrl);
      setSlots((prev) => {
        const next = [...prev];
        next[resolvedSlot] = {
          dataUrl: draft.dataUrl,
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          storagePath: draft.originalStoragePath,
          imageRatio,
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        };
        return compactSlotsLeft(next);
      });
      removePhotoModifyDraft(modifiedId);
      pendingSlotRef.current = null;
      const returnItemId = draft.itemId || draftItemId || requestedItemId;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("photoModifyId");
      if (returnItemId) params.set("itemId", returnItemId);
      const returnTo = params.toString() ? `/items/new?${params.toString()}` : "/items/new";
      router.replace(returnTo);
    })();
  }, [draftItemId, requestedItemId, router, searchParams]);

  const openPickerForSlot = (index: number) => {
    activeSlotRef.current = index;
    pendingSlotRef.current = index;
    fileInputRef.current?.click();
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const slotIndex = pendingSlotRef.current ?? activeSlotRef.current;
    const dataUrl = await fileToDataUrl(file);
    const draftId = crypto.randomUUID();
    const currentParams = new URLSearchParams(searchParams.toString());
    if (draftItemId) currentParams.set("itemId", draftItemId);
    const returnPathWithParams = `/items/new?${currentParams.toString()}`;
    try {
      savePhotoModifyDraft({
        id: draftId,
        source: "item",
        returnPath: returnPathWithParams,
        dataUrl,
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        itemId: draftItemId ?? undefined,
        slot: slotIndex,
        aspect: "square",
        offset: { x: 0, y: 0 },
        zoom: 1,
        status: "pending",
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Impossible de préparer la photo.");
      event.target.value = "";
      return;
    }
    router.push(`/modify?id=${encodeURIComponent(draftId)}`);
    pendingSlotRef.current = null;
    event.target.value = "";
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsSubmitting(false);
      setErrorMessage("Session invalide.");
      return;
    }

    if (!draftItemId) {
      setIsSubmitting(false);
      setErrorMessage("Brouillon introuvable.");
      return;
    }

    const missingStoragePath = slots.some((slot) => slot && !slot.storagePath);
    if (missingStoragePath) {
      setIsSubmitting(false);
      setErrorMessage("Certaines photos ne sont pas encore enregistrées. Ouvre-les puis valide avec \"Terminé\".");
      return;
    }

    const photosPayload = buildPhotosPayload();
    if (!photosPayload) {
      setIsSubmitting(false);
      return;
    }

    const { error: upsertError } = await supabase
      .from("items")
      .upsert(
        {
          id: draftItemId,
          owner_user_id: user.id,
          title: itemTitle.trim(),
          description: description.trim() || null,
          photos: photosPayload,
          status: "valuation",
          ...infoIds,
        },
        { onConflict: "id" },
      );

    if (!upsertError && conditionParam) {
      const conditionScore = CONDITION_LABEL_TO_SCORE[conditionParam] ?? "bon";
      await supabase.from("item_condition_history").delete().eq("item_id", draftItemId).eq("status", "draft");
      await supabase.from("item_condition_history").insert({
        item_id: draftItemId,
        source: "owner_announced",
        condition_score: conditionScore,
        defect_notes: conditionDetailsParam || null,
        status: "confirmed",
        recorded_by_user_id: user.id,
      });
    }

    setIsSubmitting(false);
    if (upsertError) {
      setErrorMessage(upsertError.message);
      return;
    }
    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    router.push(`/items/${draftItemId}/evaluation`);
  };

  const onKeepDraft = () => {
    void (async () => {
      if (!draftItemId || isKeepingDraft) return;
      setErrorMessage(null);
      setIsKeepingDraft(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setIsKeepingDraft(false);
        setErrorMessage("Session invalide.");
        return;
      }

      const missingStoragePath = slots.some((slot) => slot && !slot.storagePath);
      if (missingStoragePath) {
        setIsKeepingDraft(false);
        setErrorMessage("Certaines photos ne sont pas encore enregistrées. Ouvre-les puis valide avec \"Terminé\".");
        return;
      }

      const photosPayload = buildPhotosPayload();

      const { error: upsertError } = await supabase
        .from("items")
        .upsert(
          {
            id: draftItemId,
            owner_user_id: user.id,
            title: itemTitle.trim(),
            description: description.trim() || null,
            photos: photosPayload,
            status: "draft",
            ...infoIds,
          },
          { onConflict: "id" },
        );

      if (!upsertError && conditionParam) {
        const conditionScore = CONDITION_LABEL_TO_SCORE[conditionParam] ?? "bon";
        await upsertDraftCondition(supabase, draftItemId, user.id, conditionScore, conditionDetailsParam || null);
      }

      setIsKeepingDraft(false);
      if (upsertError) {
        setErrorMessage(upsertError.message);
        return;
      }

      setShowCancelModal(false);
      router.push("/exchange");
    })();
  };

  const onDeleteDraft = async () => {
    if (!draftItemId || isDeletingDraft) return;
    setErrorMessage(null);
    setIsDeletingDraft(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setIsDeletingDraft(false);
      setErrorMessage("Session invalide.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("items")
      .update({
        status: "draft_deleted",
      })
      .eq("id", draftItemId)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);

    setIsDeletingDraft(false);
    if (deleteError) {
      setErrorMessage(deleteError.message);
      return;
    }

    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    setShowCancelModal(false);
    router.push("/exchange");
  };

  const moveSlot = (fromIndex: number, toIndex: number) => {
    setSlots((prev) => {
      if (fromIndex === toIndex || !prev[fromIndex]) return prev;
      const next = [...prev];
      const temp = next[toIndex];
      next[toIndex] = next[fromIndex];
      next[fromIndex] = temp;
      return compactSlotsLeft(next);
    });
  };

  const buildPhotosPayload = (): Record<string, unknown> => {
    const photosPayload: Record<string, unknown> = {};
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot) continue;
      if (slot.storagePath) {
        photosPayload[`photo${index + 1}`] = {
          url: slot.storagePath,
          storage_path: slot.storagePath,
          position: {
            offset: slot.offset,
            zoom: slot.zoom,
            aspect: "square",
          },
        };
      }
    }
    return photosPayload;
  };

  const clearSlot = (index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return compactSlotsLeft(next);
    });
  };

  const onDropSlot = (dropIndex: number) => {
    if (draggingIndex !== null) {
      moveSlot(draggingIndex, dropIndex);
    }
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const onTouchMoveSlot = (event: TouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    if (!touch) return;

    if (draggingIndex === null && touchStartRef.current) {
      const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
      if (deltaX > 8 || deltaY > 8) {
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
      return;
    }

    if (draggingIndex === null) return;
    setDragPreview((prev) => (prev ? { ...prev, x: touch.clientX, y: touch.clientY } : prev));
    const hovered = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-slot-index]");
    const rawIndex = hovered?.getAttribute("data-slot-index");
    const nextIndex = rawIndex ? Number(rawIndex) : null;
    setDragOverIndex(Number.isInteger(nextIndex) ? (nextIndex as number) : null);
  };

  const onTouchEndSlot = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;

    if (draggingIndex !== null && dragOverIndex !== null) {
      moveSlot(draggingIndex, dragOverIndex);
    }
    if (draggingIndex !== null) {
      suppressNextClickRef.current = true;
    }
    setDraggingIndex(null);
    setDragOverIndex(null);
    setDragPreview(null);
  };

  const shouldBlockInitialReveal = Boolean(requestedItemId) && isInitializingDraft;

  if (shouldBlockInitialReveal) {
    return <AppLoadingScreen />;
  }

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-[430px] bg-white pb-24">
      <header className="sticky top-0 z-20 bg-white pt-5">
        <div className="px-4 pb-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <button type="button" onClick={() => setShowCancelModal(true)} className="justify-self-start px-2 text-[20px] font-bold text-[#5E3023]">
              Annuler
            </button>
            <div className="text-center">
              <h1 className="text-[24px] font-semibold leading-none text-zinc-950">New Item</h1>
              <p className={cn("mt-1 text-[14px] font-semibold", completionScore >= 100 ? "text-emerald-600" : "text-[#E44D3E]")}>{completionScore} % Terminé</p>
            </div>
            <button
              type="submit"
              form={formId}
              disabled={!canSubmit}
              className={cn(
                "justify-self-end px-2 text-[20px] font-bold transition-colors",
                canSubmit ? "text-[#5E3023]" : "text-zinc-300",
              )}
            >
              {isSubmitting ? "..." : "Évaluer"}
            </button>
          </div>
        </div>
        <div className="border-b border-zinc-200 px-1">
          <div className="grid w-full grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={cn(
                "h-12 border-b-2 text-[20px] font-extrabold",
                mode === "edit" ? "border-[#5E3023] text-[#5E3023]" : "border-transparent text-zinc-300",
              )}
            >
              Modifier
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className={cn(
                "h-12 border-b-2 text-[20px] font-extrabold",
                mode === "view" ? "border-[#5E3023] text-[#5E3023]" : "border-transparent text-zinc-300",
              )}
            >
              Voir
            </button>
          </div>
        </div>
      </header>

      <div className="px-6">
      <div className="space-y-20">
        {mode === "view" ? (
          <ItemViewView
            title={itemTitle}
            description={description}
            slots={slots}
            ownerUserId={currentUserId}
            infoCard={{
              pricePoints: itemPricePoints,
              ratingValue: "5.0",
              ratingStars: 5,
              size: infoValues.size,
              materials: infoValues.materials,
              color: infoValues.color,
              brand: infoValues.brand,
              condition: infoValues.condition,
            }}
          />
        ) : (
        <form id={formId} onSubmit={onSubmit} className="space-y-8">
          <section className="space-y-4 pt-8">
            <Input
              placeholder="Nom de la pièce"
              value={itemTitle}
              onChange={(event) => setItemTitle(event.target.value)}
              className={cn(
                playfairDisplay.className,
                "h-auto rounded-none border-0 border-b border-zinc-900 bg-transparent px-0 pb-3 pt-0 text-[30px] font-extrabold italic leading-none placeholder:italic placeholder:text-zinc-900 focus:border-b-2",
              )}
            />
          </section>

          <section className="space-y-4">
            <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-zinc-400")}>Photos</p>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot, index) => (
                <button
                  key={`item-photo-slot-${index}`}
                  data-slot-index={index}
                  type="button"
                  draggable={Boolean(slot)}
                  onDragStart={(event) => {
                    setDraggingIndex(index);
                    if (slot) {
                      setDragPreview({ url: slot.dataUrl, x: event.clientX, y: event.clientY });
                    }
                    if (event.dataTransfer) {
                      const transparentPixel = new Image();
                      transparentPixel.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                      event.dataTransfer.setDragImage(transparentPixel, 0, 0);
                    }
                  }}
                  onDrag={(event) => {
                    if (!slot) return;
                    if (event.clientX === 0 && event.clientY === 0) return;
                    setDragPreview({ url: slot.dataUrl, x: event.clientX, y: event.clientY });
                  }}
                  onDragEnd={() => {
                    setDraggingIndex(null);
                    setDragOverIndex(null);
                    setDragPreview(null);
                  }}
                  onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                  onDragEnter={() => setDragOverIndex(index)}
                  onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
                  onDrop={() => onDropSlot(index)}
                  onTouchStart={(event) => {
                    if (slot) {
                      const touch = event.touches[0];
                      if (!touch) return;
                      touchStartRef.current = { x: touch.clientX, y: touch.clientY, index };
                      if (longPressTimerRef.current !== null) {
                        window.clearTimeout(longPressTimerRef.current);
                      }
                      longPressTimerRef.current = window.setTimeout(() => {
                        setDraggingIndex(index);
                        setDragOverIndex(index);
                        setDragPreview({ url: slot.dataUrl, x: touch.clientX, y: touch.clientY });
                        longPressTimerRef.current = null;
                      }, 220);
                    }
                  }}
                  onTouchMove={onTouchMoveSlot}
                  onTouchEnd={onTouchEndSlot}
                  onTouchCancel={onTouchEndSlot}
                  onClick={() => {
                    if (suppressNextClickRef.current) {
                      suppressNextClickRef.current = false;
                      return;
                    }
                    if (slot) {
                      const draftId = crypto.randomUUID();
                      const paramsForReturn = new URLSearchParams(searchParams.toString());
                      if (draftItemId) paramsForReturn.set("itemId", draftItemId);
                      const returnPathWithParams = `/items/new?${paramsForReturn.toString()}`;
                      try {
                        savePhotoModifyDraft({
                          id: draftId,
                          source: "item",
                          returnPath: returnPathWithParams,
                          dataUrl: slot.dataUrl,
                          originalStoragePath: slot.storagePath,
                          fileName: slot.fileName,
                          mimeType: slot.mimeType,
                          itemId: draftItemId ?? undefined,
                          slot: index,
                          aspect: "square",
                          offset: { x: slot.offset.x, y: slot.offset.y },
                          zoom: slot.zoom,
                          status: "pending",
                        });
                      } catch (error) {
                        setErrorMessage(error instanceof Error ? error.message : "Impossible de préparer la photo.");
                        return;
                      }
                      router.push(`/modify?id=${encodeURIComponent(draftId)}`);
                      return;
                    }
                    openPickerForSlot(index);
                  }}
                  className={cn(
                    "group relative aspect-square overflow-visible rounded-2xl border-2 border-dashed transition",
                    index < 4 ? "border-[#5E3023]/55 bg-[#f7f3ef]" : "border-zinc-300 bg-white",
                    dragOverIndex === index ? "border-[#5E3023] bg-[#f3ece5]" : "",
                    slot ? "cursor-grab touch-none active:cursor-grabbing" : "",
                    draggingIndex === index ? "opacity-30" : "",
                  )}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-[14px]">
                    {slot ? (
                      <>
                        <div
                          className="h-full w-full bg-center bg-no-repeat"
                          style={{
                            backgroundColor: "#000000",
                            backgroundImage: `url(${slot.dataUrl})`,
                            backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / ITEM_STAGE_RATIO)) * slot.zoom}%`,
                            backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
                          }}
                        />
                        <span className="pointer-events-none absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/92 text-zinc-600 shadow-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                          <GripVertical size={13} />
                        </span>
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <div className="relative inline-flex items-center justify-center">
                          <ImageIcon size={28} className="text-zinc-400" />
                          <span className="absolute -bottom-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5E3023] text-white">
                            <Plus size={14} strokeWidth={3} />
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {slot ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearSlot(index);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        clearSlot(index);
                      }}
                      className="absolute -left-[7px] -top-[7px] z-20 inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm opacity-100 transition-opacity duration-150 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100"
                      aria-label={`Supprimer la photo ${index + 1}`}
                    >
                      <X size={11} strokeWidth={2.8} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <p className={cn(montserrat.className, "text-[14px] italic text-zinc-400")}>Fais glisser une photo pour réorganiser l&apos;ordre.</p>
              <p className={cn(montserrat.className, "-mt-0.5 text-[14px] font-bold leading-none text-[#5E3023]")}>Ajoute 4 à 6 photos</p>
            </div>
          </section>

          <section className="space-y-4">
            <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-zinc-400")}>Description</p>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Décris la pièce: coupe, matière, occasion, défauts éventuels..."
              className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
          </section>

          <section className="space-y-4">
            <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-zinc-400")}>Infos</p>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              {INFO_LINKS.filter((item) => (item.key === "size" ? showSizeLink : true)).map((item, index) => (
                <Link
                  key={item.key}
                  href={`${item.href}?${new URLSearchParams({
                    title: itemTitle,
                    description,
                    category: infoValues.category === "-" ? "" : infoValues.category,
                    brand: infoValues.brand === "-" ? "" : infoValues.brand,
                    size: infoValues.size === "-" ? "" : infoValues.size,
                    condition: infoValues.condition === "-" ? "" : infoValues.condition,
                    materials: infoValues.materials === "-" ? "" : infoValues.materials,
                    color: infoValues.color === "-" ? "" : infoValues.color,
                    materialsId: searchParams.get("materialsId") ?? "",
                    colorId: searchParams.get("colorId") ?? "",
                    conditionDetails: searchParams.get("conditionDetails") ?? "",
                    conditionDefectPhotoCount: searchParams.get("conditionDefectPhotoCount") ?? "",
                    itemId: searchParams.get("itemId") ?? draftItemId ?? "",
                    categoryId: searchParams.get("categoryId") ?? "",
                    brandId: searchParams.get("brandId") ?? "",
                    sizeId: searchParams.get("sizeId") ?? "",
                  }).toString()}`}
                  className={cn("flex items-center justify-between px-4 py-3 transition hover:bg-zinc-50", index > 0 ? "border-t border-zinc-200" : "")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[18px] font-semibold leading-none text-zinc-900">{item.label}</p>
                    <p className="mt-1 truncate text-[14px] leading-none text-zinc-400">{infoValues[item.key]}</p>
                  </div>
                  <ChevronRight className="ml-3 h-4 w-4 text-zinc-400" />
                </Link>
              ))}
            </div>
          </section>
          {errorMessage ? <p className="text-sm text-[#E44D3E]">{errorMessage}</p> : null}
        </form>
        )}
      </div>
      </div>
      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[90] h-24 w-24 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/70 shadow-[0_10px_24px_rgba(0,0,0,0.25)]"
          style={{ left: dragPreview.x, top: dragPreview.y }}
          aria-hidden
        >
          <img src={dragPreview.url} alt="" className="h-full w-full object-cover opacity-95" />
        </div>
      ) : null}
      {showCancelModal ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[430px] rounded-3xl bg-white p-5 shadow-xl">
            <h3 className="text-[20px] font-semibold text-zinc-900">Quitter l&apos;édition ?</h3>
            <p className="mt-2 text-sm text-zinc-600">Tu peux garder le brouillon, ou supprimer définitivement cet item.</p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={onKeepDraft}
                disabled={isKeepingDraft}
                className="h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-900 disabled:opacity-60"
              >
                {isKeepingDraft ? "Sauvegarde..." : "Garder le brouillon"}
              </button>
              <button
                type="button"
                onClick={onDeleteDraft}
                disabled={isDeletingDraft}
                className="h-11 rounded-xl bg-[#E44D3E] text-sm font-semibold text-white disabled:opacity-60"
              >
                {isDeletingDraft ? "Suppression..." : "Supprimer cet item"}
              </button>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="h-11 rounded-xl text-sm font-semibold text-zinc-500"
              >
                Continuer l&apos;édition
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
