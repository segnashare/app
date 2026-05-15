"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight, GripVertical, Image as ImageIcon, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, TouchEvent } from "react";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const montserratItalic = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { SEGNA_DIALOG_CARD_CLASS, segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { AppLoadingScreen } from "@/components/ui/AppLoadingScreen";
import { Input } from "@/components/ui/Input";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import {
  dataUrlToFile,
  fileToDataUrl,
  readPhotoModifyDraft,
  removePhotoModifyDraft,
  savePhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
import {
  clearItemInfoDraft,
  getItemInfoDraft,
  getLastDbLoadedItemId,
  setItemInfoDraft,
  setLastDbLoadedItemId,
  type ItemInfoDraft,
} from "@/lib/items/itemInfoDraftStorage";
import { formatItemCustomBrandLabel, ITEM_BRAND_AUTRE_SLUG } from "@/lib/items/format-item-custom-brand-label";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { clearFromItemSession, setPostSubmitBlock, withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient, getBrowserAuthUser } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";
import { cn } from "@/lib/utils/cn";

const ItemViewView = dynamic(
  () => import("@/components/item/ItemViewView").then((m) => m.ItemViewView),
  { loading: () => <AppLoadingScreen /> },
);







const INFO_LINKS = [
  { key: "category", label: "Catégorie", href: "/items/new/category" },
  { key: "size", label: "Taille", href: "/items/new/size" },
  { key: "brand", label: "Marque", href: "/items/new/brand" },
  { key: "condition", label: "État", href: "/items/new/condition" },
  { key: "color", label: "Couleur", href: "/items/new/color" },
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
/** Parcours /items/proposal → première ligne `items` avec `pre_subscribe_proposal` (pas d’expédition auto à la validation). */
const PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY = "segna:new-item:pre-subscribe-proposal";

function readPreSubscribeProposalFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

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
  // Contrainte DB: une seule ligne draft par item (index unique partiel).
  // Strategie robuste: update si draft existe, sinon insert; en cas de course 409, retry update.
  const payload = {
    source: "owner_announced",
    condition_score: conditionScore,
    defect_notes: defectNotes,
    status: "draft",
    recorded_by_user_id: userId,
  };

  const { data: existingDraft, error: selError } = await supabase
    .from("item_condition_history")
    .select("id")
    .eq("item_id", itemId)
    .eq("status", "draft")
    .maybeSingle();
  if (selError) return { error: new Error(selError.message) };

  if (existingDraft?.id) {
    const { error: updError } = await supabase
      .from("item_condition_history")
      .update(payload)
      .eq("id", existingDraft.id)
      .eq("item_id", itemId)
      .eq("status", "draft");
    return { error: updError ? new Error(updError.message) : null };
  }

  const { error: insError } = await supabase.from("item_condition_history").insert({
    item_id: itemId,
    ...payload,
  });
  if (!insError) return { error: null };

  // Si conflit unique en insertion, un draft a ete cree entre-temps: on update la ligne existante.
  if (insError.code === "23505") {
    const { error: raceUpdError } = await supabase
      .from("item_condition_history")
      .update(payload)
      .eq("item_id", itemId)
      .eq("status", "draft");
    return { error: raceUpdError ? new Error(raceUpdError.message) : null };
  }

  return { error: new Error(insError.message) };
}

async function advanceExchangeOnboardingToReward(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ onboarding_process: "reward" })
    .eq("id", userId)
    .eq("onboarding_process", "exchange");
  if (error) {
    console.warn("[onboarding] exchange -> reward failed", error.message);
  }
}

const CONDITION_SCORE_TO_LABEL: Record<string, string> = {
  neuf_etiquette: "Neuf avec étiquette",
  excellent: "Excellent état",
  tres_bon: "Très bon état",
  bon: "Bon état",
  acceptable: "Acceptable",
  degrade: "Dégradé",
};
const ITEM_STAGE_RATIO = 3 / 4;

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

function normalizeStringValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function normalizePhotosForComparison(photosRaw: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const entries = getPhotoEntriesFromJson(photosRaw).slice(0, 6);
  for (let index = 0; index < entries.length; index += 1) {
    const row = entries[index];
    const storagePathRaw = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
    const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
    if (!storagePath) continue;
    const position = row.position && typeof row.position === "object" ? (row.position as Record<string, unknown>) : null;
    const offsetRaw = position?.offset && typeof position.offset === "object" ? (position.offset as Record<string, unknown>) : null;
    const offsetX = typeof offsetRaw?.x === "number" ? offsetRaw.x : 0;
    const offsetY = typeof offsetRaw?.y === "number" ? offsetRaw.y : 0;
    const zoom = typeof position?.zoom === "number" ? position.zoom : 1;
    payload[`photo${index + 1}`] = {
      url: storagePath,
      storage_path: storagePath,
      position: {
        offset: { x: offsetX, y: offsetY },
        zoom,
        aspect: "square",
      },
    };
  }
  return payload;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedItemId = searchParams.get("itemId")?.trim() || null;
  const forceFreshDraft = searchParams.get("fresh") === "1";
  const proposalFromUrl = searchParams.get("proposal") === "1";
  const photoModifyIdFromUrl = searchParams.get("photoModifyId");
  /** Evite de relancer ensureDraft a chaque changement de reference de searchParams (clignotement loader / contenu). */
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
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
  const [itemTitle, setItemTitle] = useState("");
  const [description, setDescription] = useState("");
  const [infoDraft, setInfoDraft] = useState<ItemInfoDraft>({});
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [isInitializingDraft, setIsInitializingDraft] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [isKeepingDraft, setIsKeepingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasHydratedSlots, setHasHydratedSlots] = useState(false);
  const [photoEditVersion, setPhotoEditVersion] = useState(0);
  const [itemPricePoints, setItemPricePoints] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [itemStatus, setItemStatus] = useState<string | null>(null);
  const [intakeListingStage, setIntakeListingStage] = useState<string | null>(null);
  const formId = "new-item-form";

  const stLower = itemStatus?.toLowerCase() ?? "";
  const isDraftInIntakePipeline =
    stLower === "draft" &&
    intakeListingStage != null &&
    ["evaluation", "evaluated", "validation_pending"].includes(intakeListingStage);
  const isEditValidationMode = itemStatus != null && isDraftInIntakePipeline;
  const filledPhotosCount = slots.filter(Boolean).length;
  const categoryId = infoDraft.categoryId?.trim() || null;
  const brandId = infoDraft.brandId?.trim() || null;
  const brandNeedsCustomLabel = infoDraft.brandSlug === ITEM_BRAND_AUTRE_SLUG;
  const formattedCustomBrand =
    brandNeedsCustomLabel && infoDraft.customBrandLabel?.trim()
      ? formatItemCustomBrandLabel(infoDraft.customBrandLabel)
      : null;
  const infoValues = {
    category: infoDraft.category ?? "-",
    brand: formattedCustomBrand ?? infoDraft.brand ?? "-",
    size: infoDraft.size ?? "-",
    condition: infoDraft.condition ?? "-",
    materials: infoDraft.materials ?? "-",
    color: infoDraft.color ?? "-",
  };
  const sizeId = infoDraft.sizeId?.trim() || null;
  const materialsId = infoDraft.materialsId?.trim() || null;
  const colorId = infoDraft.colorId?.trim() || null;
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

  const hasMinPhotos = filledPhotosCount >= 4;
  const hasCondition = Boolean(infoDraft.condition?.trim());
  const sizeStepOk =
    Boolean(categoryId) && (!showSizeLink || Boolean(sizeId));
  const requiredChecks = [
    itemTitle.trim().length > 0,
    description.trim().length > 0,
    hasMinPhotos,
    Boolean(categoryId),
    Boolean(brandId) && (!brandNeedsCustomLabel || Boolean(infoDraft.customBrandLabel?.trim())),
    hasCondition,
    Boolean(colorId),
    Boolean(materialsId),
    sizeStepOk,
  ];
  const completionScore = Math.round((requiredChecks.filter(Boolean).length / requiredChecks.length) * 100);

  const infoIds = {
    ...(categoryId ? { item_category_id: categoryId } : {}),
    ...(brandId ? { item_brand_id: brandId } : {}),
    item_custom_brand_label: brandNeedsCustomLabel ? formattedCustomBrand : null,
    ...(sizeId ? { item_size_id: sizeId } : {}),
    ...(materialsId ? { item_materiaux_id: materialsId } : {}),
    ...(colorId ? { item_couleur_id: colorId } : {}),
  };
  const canSubmit = completionScore >= 100 && !!draftItemId && !isInitializingDraft && !isSubmitting;

  useEffect(() => {
    if (!forceFreshDraft) return;
    const params = new URLSearchParams();
    if (requestedItemId) params.set("itemId", requestedItemId);
    if (searchParams.get("proposal") === "1") params.set("proposal", "1");
    router.replace(params.toString() ? `/items/new?${params.toString()}` : "/items/new");
  }, [forceFreshDraft, requestedItemId, router, searchParams]);

  useEffect(() => {
    if (!proposalFromUrl) return;
    try {
      sessionStorage.setItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY, "1");
    } catch {
      // ignore
    }
  }, [proposalFromUrl]);

  useEffect(() => {
    let isUnmounted = false;

    const ensureDraft = async () => {
      setErrorMessage(null);
      setIsInitializingDraft(true);
      if (!requestedItemId && forceFreshDraft) {
        sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
        sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
        clearItemInfoDraft();
        setSlots([null, null, null, null, null, null]);
        try {
          if (searchParamsRef.current.get("proposal") === "1") {
            sessionStorage.setItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY, "1");
          } else {
            sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
          }
        } catch {
          // ignore
        }
      } else if (!requestedItemId && !forceFreshDraft) {
        try {
          if (searchParamsRef.current.get("proposal") !== "1") {
            sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
          }
        } catch {
          // ignore
        }
      }
      const {
        data: { user },
        error: userError,
      } = await getBrowserAuthUser(supabase);

      if (isUnmounted) return;
      if (userError || !user) {
        setCurrentUserId(null);
        setErrorMessage("Session invalide.");
        setIsInitializingDraft(false);
        return;
      }
      setCurrentUserId(user.id);

      if (requestedItemId) {
        try {
          sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
        } catch {
          // ignore
        }
        if (forceFreshDraft) setLastDbLoadedItemId(null);
        const existingDraftId = sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
        if (existingDraftId && existingDraftId !== requestedItemId) {
          sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
          setSlots([null, null, null, null, null, null]);
          setLastDbLoadedItemId(null);
        }

        sessionStorage.setItem(ACTIVE_DRAFT_ID_STORAGE_KEY, requestedItemId);
        setDraftItemId(requestedItemId);

        // Déjà chargé dans cette session (retour sous-page) : ne pas écraser le sessionStorage
        if (!forceFreshDraft && getLastDbLoadedItemId() === requestedItemId) {
          setInfoDraft(getItemInfoDraft());
          let nextTitle = "";
          let nextDescription = "";
          try {
            const rawLocalText = sessionStorage.getItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
            if (rawLocalText) {
              const parsed = JSON.parse(rawLocalText) as { itemId?: string; title?: string; description?: string };
              if (parsed?.itemId === requestedItemId) {
                nextTitle = parsed.title ?? "";
                nextDescription = parsed.description ?? "";
              }
            }
          } catch {
            // Ignore.
          }
          setItemTitle(nextTitle);
          setDescription(nextDescription);
          // Ne pas charger les slots depuis sessionStorage si on revient avec photoModifyId
          // (l'effet photoModifyId ajoutera la nouvelle photo aux slots existants)
          if (!searchParamsRef.current.get("photoModifyId")) {
            try {
              const rawLocalSlots = sessionStorage.getItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
              if (rawLocalSlots) {
                const parsedLocalSlots = JSON.parse(rawLocalSlots) as Array<ItemPhotoSlot | null>;
                if (Array.isArray(parsedLocalSlots) && parsedLocalSlots.length === 6) {
                  setSlots(compactSlotsLeft(parsedLocalSlots));
                }
              }
            } catch {
              // Ignore.
            }
          }
          const [{ data: metaRow }, { data: intakeQuick }] = await Promise.all([
            supabase
              .from("items")
              .select("price_points,status")
              .eq("id", requestedItemId)
              .eq("owner_user_id", user.id)
              .maybeSingle(),
            supabase.from("item_intake").select("listing_stage").eq("item_id", requestedItemId).maybeSingle(),
          ]);
          if (!isUnmounted && metaRow) {
            setItemPricePoints(
              typeof (metaRow as { price_points?: number | null }).price_points === "number"
                ? (metaRow as { price_points: number }).price_points
                : null,
            );
            setItemStatus((metaRow as { status?: string | null }).status ?? null);
            setIntakeListingStage(
              typeof intakeQuick?.listing_stage === "string" ? intakeQuick.listing_stage : null,
            );
          }
          setIsInitializingDraft(false);
          return;
        }

        const { data: itemData, error: itemError } = await supabase
          .from("items")
          .select(
            "id,title,description,photos,item_category_id,item_brand_id,item_custom_brand_label,item_size_id,item_materiaux_id,item_couleur_id,price_points,status, item_intake(listing_stage)",
          )
          .eq("id", requestedItemId)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle();

        if (isUnmounted) return;
        if (itemError || !itemData) {
          setDraftItemId(requestedItemId);
          let nextTitle = "";
          let nextDescription = "";
          try {
            const rawLocalText = sessionStorage.getItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
            if (rawLocalText) {
              const parsed = JSON.parse(rawLocalText) as { itemId?: string; title?: string; description?: string };
              if (parsed?.itemId === requestedItemId) {
                nextTitle = parsed.title ?? "";
                nextDescription = parsed.description ?? "";
              }
            }
          } catch {
            // Ignore malformed local text draft.
          }
          setItemTitle(nextTitle);
          setDescription(nextDescription);
          setInfoDraft(getItemInfoDraft());
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
          router.replace(`/items/new?itemId=${requestedItemId}`);
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
        setItemStatus((itemData as { status?: string | null }).status ?? null);
        const intakeEmb = (itemData as { item_intake?: { listing_stage?: string } | null }).item_intake;
        setIntakeListingStage(
          intakeEmb && typeof intakeEmb === "object" && typeof intakeEmb.listing_stage === "string"
            ? intakeEmb.listing_stage
            : null,
        );

        const nextInfo: ItemInfoDraft = {};
        if (itemData.item_category_id) {
          const { data: catRow } = await supabase
            .from("item_categories")
            .select("name")
            .eq("id", itemData.item_category_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (catRow) {
            nextInfo.categoryId = itemData.item_category_id;
            nextInfo.category = (catRow as { name?: string }).name ?? "";
          }
        }
        if (itemData.item_brand_id) {
          const { data: brandRow } = await supabase
            .from("item_brands")
            .select("label,slug")
            .eq("id", itemData.item_brand_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (brandRow) {
            const slug = (brandRow as { slug?: string }).slug ?? null;
            const custom = (
              itemData as { item_custom_brand_label?: string | null }
            ).item_custom_brand_label?.trim() || null;
            nextInfo.brandId = itemData.item_brand_id;
            nextInfo.brandSlug = slug;
            nextInfo.customBrandLabel = custom;
            if (slug === ITEM_BRAND_AUTRE_SLUG && custom) {
              nextInfo.brand = custom;
            } else {
              nextInfo.brand = (brandRow as { label?: string }).label ?? "";
            }
          }
        }
        if (itemData.item_size_id) {
          const { data: sizeRow } = await supabase
            .from("sizes")
            .select("code,label")
            .eq("id", itemData.item_size_id)
            .maybeSingle();
          if (isUnmounted) return;
          if (sizeRow) {
            const s = sizeRow as { code?: string; label?: string | null };
            nextInfo.sizeId = itemData.item_size_id;
            nextInfo.size = s.label ?? (s.code?.includes(":") ? s.code.split(":")[1] ?? s.code : s.code ?? "");
          }
        }
        if ((itemData as { item_materiaux_id?: string | null }).item_materiaux_id) {
          const matId = (itemData as { item_materiaux_id: string }).item_materiaux_id;
          const { data: matRow } = await supabase.from("item_materiaux").select("label").eq("id", matId).maybeSingle();
          if (isUnmounted) return;
          if (matRow) {
            nextInfo.materialsId = matId;
            nextInfo.materials = (matRow as { label?: string }).label ?? "";
          }
        }
        if ((itemData as { item_couleur_id?: string | null }).item_couleur_id) {
          const colId = (itemData as { item_couleur_id: string }).item_couleur_id;
          const { data: colRow } = await supabase.from("item_couleurs").select("label").eq("id", colId).maybeSingle();
          if (isUnmounted) return;
          if (colRow) {
            nextInfo.colorId = colId;
            nextInfo.color = (colRow as { label?: string }).label ?? "";
          }
        }
        const { data: condRow } = await supabase
          .from("item_condition_history")
          .select("condition_score,defect_notes")
          .eq("item_id", requestedItemId)
          .eq("source", "owner_announced")
          .maybeSingle();
        if (isUnmounted) return;
        if (condRow) {
          const c = condRow as { condition_score?: string; defect_notes?: string | null };
          nextInfo.condition = c.condition_score ? CONDITION_SCORE_TO_LABEL[c.condition_score] ?? c.condition_score : "";
          nextInfo.conditionDetails = c.defect_notes?.trim() || null;
        }
        setItemInfoDraft(nextInfo);
        setInfoDraft(nextInfo);
        setLastDbLoadedItemId(requestedItemId);

        router.replace(`/items/new?itemId=${requestedItemId}`);

        // Lors de l'édition d'un item existant, toujours charger les photos depuis la DB
        // (les slots locaux ne sont pas fiables car non associés à l'itemId)
        const photoEntries = getPhotoEntriesFromJson(itemData.photos).slice(0, 6);
        const nextSlots: Array<ItemPhotoSlot | null> = [null, null, null, null, null, null];

        for (let index = 0; index < photoEntries.length; index += 1) {
          const row = photoEntries[index];
          const storagePathRaw = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
          const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
          if (!storagePath) continue;

          const explicitBucket =
            (typeof row.bucket_id === "string" && row.bucket_id) ||
            (typeof row.storage_bucket === "string" && row.storage_bucket) ||
            (typeof row.bucket === "string" && row.bucket) ||
            null;
          const previewUrl = await createSignedUrlForStoragePath(
            supabase,
            storagePath,
            60 * 60 * 24,
            explicitBucket ? { explicitBucket } : undefined,
          );
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

        // Ne pas écraser les slots si on revient de modify avec une nouvelle photo (photoModifyId)
        if (!isUnmounted && !searchParamsRef.current.get("photoModifyId")) {
          setSlots(compactSlotsLeft(nextSlots));
        }
        setIsInitializingDraft(false);
        return;
      }

      const existingDraftId = sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
      if (existingDraftId && !forceFreshDraft) {
        setDraftItemId(existingDraftId);
        const { data: existingItemData } = await supabase
          .from("items")
          .select("title,description,price_points,photos,item_category_id,item_brand_id,item_custom_brand_label,item_size_id,item_materiaux_id,item_couleur_id")
          .eq("id", existingDraftId)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (isUnmounted) return;
        let nextTitle = "";
        let nextDescription = "";
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
        if (existingItemData) {
          const d = existingItemData as {
            item_category_id?: string | null;
            item_brand_id?: string | null;
            item_size_id?: string | null;
            item_materiaux_id?: string | null;
            item_couleur_id?: string | null;
          };
          const nextInfo: ItemInfoDraft = {};
          if (d.item_category_id) {
            const { data: catRow } = await supabase.from("item_categories").select("name").eq("id", d.item_category_id).maybeSingle();
            if (catRow) {
              nextInfo.categoryId = d.item_category_id;
              nextInfo.category = (catRow as { name?: string }).name ?? "";
            }
          }
          if (d.item_brand_id) {
            const { data: brandRow } = await supabase
              .from("item_brands")
              .select("label,slug")
              .eq("id", d.item_brand_id)
              .maybeSingle();
            if (brandRow) {
              const slug = (brandRow as { slug?: string }).slug ?? null;
              const custom = (d as { item_custom_brand_label?: string | null }).item_custom_brand_label?.trim() || null;
              nextInfo.brandId = d.item_brand_id;
              nextInfo.brandSlug = slug;
              nextInfo.customBrandLabel = custom;
              if (slug === ITEM_BRAND_AUTRE_SLUG && custom) {
                nextInfo.brand = custom;
              } else {
                nextInfo.brand = (brandRow as { label?: string }).label ?? "";
              }
            }
          }
          if (d.item_size_id) {
            const { data: sizeRow } = await supabase.from("sizes").select("code,label").eq("id", d.item_size_id).maybeSingle();
            if (sizeRow) {
              const s = sizeRow as { code?: string; label?: string | null };
              nextInfo.sizeId = d.item_size_id;
              nextInfo.size = s.label ?? (s.code?.includes(":") ? s.code.split(":")[1] ?? s.code : s.code ?? "");
            }
          }
          if (d.item_materiaux_id) {
            const { data: matRow } = await supabase.from("item_materiaux").select("label").eq("id", d.item_materiaux_id).maybeSingle();
            if (matRow) {
              nextInfo.materialsId = d.item_materiaux_id;
              nextInfo.materials = (matRow as { label?: string }).label ?? "";
            }
          }
          if (d.item_couleur_id) {
            const { data: colRow } = await supabase.from("item_couleurs").select("label").eq("id", d.item_couleur_id).maybeSingle();
            if (colRow) {
              nextInfo.colorId = d.item_couleur_id;
              nextInfo.color = (colRow as { label?: string }).label ?? "";
            }
          }
          const { data: condRow } = await supabase
            .from("item_condition_history")
            .select("condition_score,defect_notes")
            .eq("item_id", existingDraftId)
            .eq("source", "owner_announced")
            .maybeSingle();
          if (condRow) {
            const c = condRow as { condition_score?: string; defect_notes?: string | null };
            nextInfo.condition = c.condition_score ? CONDITION_SCORE_TO_LABEL[c.condition_score] ?? c.condition_score : "";
            nextInfo.conditionDetails = c.defect_notes?.trim() || null;
          }
          setItemInfoDraft(nextInfo);
          setInfoDraft(nextInfo);
        } else {
          setInfoDraft(getItemInfoDraft());
        }
        if (existingItemData?.photos) {
          const photoEntries = getPhotoEntriesFromJson(existingItemData.photos).slice(0, 6);
          const nextSlots: Array<ItemPhotoSlot | null> = [null, null, null, null, null, null];
          for (let index = 0; index < photoEntries.length; index += 1) {
            const row = photoEntries[index];
            const storagePathRaw = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
            const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
            if (!storagePath) continue;
            const explicitBucket =
              (typeof row.bucket_id === "string" && row.bucket_id) ||
              (typeof row.storage_bucket === "string" && row.storage_bucket) ||
              (typeof row.bucket === "string" && row.bucket) ||
              null;
            const previewUrl = await createSignedUrlForStoragePath(
              supabase,
              storagePath,
              60 * 60 * 24,
              explicitBucket ? { explicitBucket } : undefined,
            );
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
          if (!isUnmounted && !searchParamsRef.current.get("photoModifyId")) setSlots(compactSlotsLeft(nextSlots));
        }
        setIsInitializingDraft(false);
        return;
      }

      sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
      clearItemInfoDraft();
      sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
      setSlots([null, null, null, null, null, null]);
      setItemTitle("");
      setDescription("");
      setInfoDraft({});
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
    // Ne pas dependre de `searchParams` (objet instable) : router.replace / auth / tout param hors itemId provoquait
    // un re-run, setIsInitializingDraft(true) puis false = clignotement AppLoadingScreen.
  }, [forceFreshDraft, requestedItemId, supabase]);

  useEffect(() => {
    setInfoDraft(getItemInfoDraft());
  }, []);

  useEffect(() => {
    if (pathname === "/items/new") {
      setInfoDraft(getItemInfoDraft());
    }
  }, [pathname]);

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

  const conditionParam = infoDraft.condition?.trim() || null;
  const conditionDetailsParam = infoDraft.conditionDetails?.trim() || null;

  useEffect(() => {
    const modifiedId = photoModifyIdFromUrl;
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
      setPhotoEditVersion((v) => v + 1);
      removePhotoModifyDraft(modifiedId);
      pendingSlotRef.current = null;
      // Garder l'itemId depuis l'URL : draftItemId peut être null si ensureDraft n'a pas encore fini
      const itemIdForUrl = requestedItemId || draftItemId || null;
      const returnTo = itemIdForUrl ? `/items/new?itemId=${itemIdForUrl}` : "/items/new";
      router.replace(returnTo);
    })();
  }, [draftItemId, photoModifyIdFromUrl, requestedItemId, router]);

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
    const returnPathWithParams = requestedItemId && draftItemId ? `/items/new?itemId=${draftItemId}` : "/items/new";
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
    } = await getBrowserAuthUser(supabase);
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

    let photosPayload: Record<string, unknown>;
    try {
      const result = await uploadSlotsAndBuildPayload();
      photosPayload = result.photosPayload;
    } catch (uploadErr) {
      setIsSubmitting(false);
      setErrorMessage(uploadErr instanceof Error ? uploadErr.message : "Impossible d'enregistrer les photos.");
      return;
    }

    const proposalCols = readPreSubscribeProposalFlag() ? { pre_subscribe_proposal: true as const } : {};
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
          ...proposalCols,
        },
        { onConflict: "id" },
      );

    if (!upsertError && conditionParam) {
      const conditionScore = CONDITION_LABEL_TO_SCORE[conditionParam] ?? "bon";
      await supabase.from("item_condition_history").delete().eq("item_id", draftItemId).eq("source", "owner_announced");
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
    const intakeErr = await setItemIntakeListingStage(supabase, draftItemId, "evaluation");
    if (!intakeErr.ok) {
      setErrorMessage(intakeErr.message);
      return;
    }
    await advanceExchangeOnboardingToReward(supabase, user.id);
    try {
      sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
    } catch {
      // ignore
    }
    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    clearItemInfoDraft();
    try {
      sessionStorage.setItem("segna:item-detail:back-href", "/exchange");
    } catch {
      // ignore
    }
    clearFromItemSession();
    setPostSubmitBlock(draftItemId);
    if (typeof window !== "undefined") {
      window.location.replace(`${window.location.origin}/items/${draftItemId}?verification=1`);
      return;
    }
    router.replace(`/items/${draftItemId}?verification=1`);
  };

  const onFinish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !draftItemId) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    const {
      data: { user },
      error: userError,
    } = await getBrowserAuthUser(supabase);
    if (userError || !user) {
      setIsSubmitting(false);
      setErrorMessage("Session invalide.");
      return;
    }

    let photosPayload: Record<string, unknown>;
    try {
      const result = await uploadSlotsAndBuildPayload();
      photosPayload = result.photosPayload;
    } catch (uploadErr) {
      setIsSubmitting(false);
      setErrorMessage(uploadErr instanceof Error ? uploadErr.message : "Impossible d'enregistrer les photos.");
      return;
    }

    const proposalCols = readPreSubscribeProposalFlag() ? { pre_subscribe_proposal: true as const } : {};
    const normalizedConditionDetails = normalizeStringValue(conditionDetailsParam);
    const nextConditionScore = conditionParam ? CONDITION_LABEL_TO_SCORE[conditionParam] ?? "bon" : null;
    const nextItemPayload = {
      title: itemTitle.trim(),
      description: description.trim() || null,
      photos: photosPayload,
      status: "draft",
      ...infoIds,
      ...proposalCols,
    };

    const [{ data: currentItem, error: currentItemError }, { data: currentCondition, error: currentConditionError }] =
      await Promise.all([
        supabase
          .from("items")
          .select(
            "title,description,photos,item_category_id,item_brand_id,item_custom_brand_label,item_size_id,item_materiaux_id,item_couleur_id,pre_subscribe_proposal,status",
          )
          .eq("id", draftItemId)
          .eq("owner_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("item_condition_history")
          .select("condition_score,defect_notes")
          .eq("item_id", draftItemId)
          .eq("source", "owner_announced")
          .maybeSingle(),
      ]);

    if (currentItemError || !currentItem) {
      setIsSubmitting(false);
      setErrorMessage(currentItemError?.message ?? "Pièce introuvable.");
      return;
    }
    if (currentConditionError) {
      setIsSubmitting(false);
      setErrorMessage(currentConditionError.message);
      return;
    }

    const currentComparable = {
      title: normalizeStringValue((currentItem as { title?: string | null }).title) ?? "",
      description: normalizeStringValue((currentItem as { description?: string | null }).description),
      photos: normalizePhotosForComparison((currentItem as { photos?: unknown }).photos),
      status: normalizeStringValue((currentItem as { status?: string | null }).status),
      item_category_id: normalizeStringValue((currentItem as { item_category_id?: string | null }).item_category_id),
      item_brand_id: normalizeStringValue((currentItem as { item_brand_id?: string | null }).item_brand_id),
      item_custom_brand_label: normalizeStringValue(
        (currentItem as { item_custom_brand_label?: string | null }).item_custom_brand_label,
      ),
      item_size_id: normalizeStringValue((currentItem as { item_size_id?: string | null }).item_size_id),
      item_materiaux_id: normalizeStringValue((currentItem as { item_materiaux_id?: string | null }).item_materiaux_id),
      item_couleur_id: normalizeStringValue((currentItem as { item_couleur_id?: string | null }).item_couleur_id),
      pre_subscribe_proposal: Boolean(
        (currentItem as { pre_subscribe_proposal?: boolean | null }).pre_subscribe_proposal,
      ),
      condition_score: normalizeStringValue((currentCondition as { condition_score?: string | null } | null)?.condition_score),
      condition_details: normalizeStringValue((currentCondition as { defect_notes?: string | null } | null)?.defect_notes),
    };

    const nextComparable = {
      title: normalizeStringValue(nextItemPayload.title) ?? "",
      description: normalizeStringValue(nextItemPayload.description),
      photos: photosPayload,
      status: normalizeStringValue(nextItemPayload.status),
      item_category_id: normalizeStringValue(nextItemPayload.item_category_id),
      item_brand_id: normalizeStringValue(nextItemPayload.item_brand_id),
      item_custom_brand_label: normalizeStringValue(nextItemPayload.item_custom_brand_label ?? null),
      item_size_id: normalizeStringValue(nextItemPayload.item_size_id),
      item_materiaux_id: normalizeStringValue(nextItemPayload.item_materiaux_id),
      item_couleur_id: normalizeStringValue(nextItemPayload.item_couleur_id),
      pre_subscribe_proposal: Boolean(nextItemPayload.pre_subscribe_proposal),
      condition_score: normalizeStringValue(nextConditionScore),
      condition_details: normalizedConditionDetails,
    };

    const hasMeaningfulChanges =
      JSON.stringify(currentComparable) !== JSON.stringify(nextComparable) || photoEditVersion > 0;
    const shouldRelaunchEvaluation = hasMeaningfulChanges || isEditValidationMode;

    if (hasMeaningfulChanges) {
      const { error: upsertError } = await supabase
        .from("items")
        .update(nextItemPayload)
        .eq("id", draftItemId)
        .eq("owner_user_id", user.id)
        .is("deleted_at", null);
      if (upsertError) {
        setIsSubmitting(false);
        setErrorMessage(upsertError.message);
        return;
      }

      if (conditionParam) {
        const conditionScore = nextConditionScore ?? "bon";
        const { error: conditionError } = await upsertDraftCondition(
          supabase,
          draftItemId,
          user.id,
          conditionScore,
          normalizedConditionDetails,
        );
        if (conditionError) {
          setIsSubmitting(false);
          setErrorMessage(conditionError.message);
          return;
        }
      }

    }

    if (shouldRelaunchEvaluation) {
      const { data: latestIntake, error: latestIntakeError } = await supabase
        .from("item_intake")
        .select("listing_stage")
        .eq("item_id", draftItemId)
        .maybeSingle();
      if (latestIntakeError) {
        setIsSubmitting(false);
        setErrorMessage(latestIntakeError.message);
        return;
      }

      const latestListingStage =
        latestIntake && typeof latestIntake.listing_stage === "string" ? latestIntake.listing_stage : null;
      const retriggerRes = await fetch("/api/items/intake/retrigger-evaluation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: draftItemId,
          restart: latestListingStage === "evaluation",
        }),
      });
      if (!retriggerRes.ok) {
        const retriggerPayload = (await retriggerRes.json().catch(() => null)) as
          | { error?: string; code?: string; stage?: string }
          | null;
        setIsSubmitting(false);
        setErrorMessage(
          retriggerPayload?.error
            ? `Relance evaluation impossible (${retriggerPayload.stage ?? "unknown"}): ${retriggerPayload.error}`
            : "Relance evaluation impossible.",
        );
        return;
      }
    }

    await advanceExchangeOnboardingToReward(supabase, user.id);
    setIsSubmitting(false);
    try {
      sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
    } catch {
      // ignore
    }
    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    clearItemInfoDraft();
    setPhotoEditVersion(0);
    router.push("/exchange");
  };

  const onKeepDraft = () => {
    void (async () => {
      if (!draftItemId || isKeepingDraft) return;
      setErrorMessage(null);
      setIsKeepingDraft(true);

      const {
        data: { user },
        error: userError,
      } = await getBrowserAuthUser(supabase);

      if (userError || !user) {
        setIsKeepingDraft(false);
        setErrorMessage("Session invalide.");
        return;
      }

      let photosPayload: Record<string, unknown>;
      try {
        const result = await uploadSlotsAndBuildPayload();
        photosPayload = result.photosPayload;
      } catch (uploadErr) {
        setIsKeepingDraft(false);
        setErrorMessage(uploadErr instanceof Error ? uploadErr.message : "Impossible d'enregistrer les photos.");
        return;
      }

      const proposalCols = readPreSubscribeProposalFlag() ? { pre_subscribe_proposal: true as const } : {};
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
            ...proposalCols,
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

      const intakeErr = await setItemIntakeListingStage(supabase, draftItemId, "draft");
      if (!intakeErr.ok) {
        setErrorMessage(intakeErr.message);
        return;
      }

      setShowCancelModal(false);
      router.push("/exchange");
    })();
  };

  const onDiscardChanges = () => {
    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    try {
      sessionStorage.removeItem(PRE_SUBSCRIBE_PROPOSAL_SESSION_KEY);
    } catch {
      // ignore
    }
    clearItemInfoDraft();
    setShowCancelModal(false);
    router.push("/exchange");
  };

  const onDeleteDraft = async () => {
    const itemIdToDelete =
      draftItemId?.trim() ||
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY)?.trim() : null) ||
      null;
    if (!itemIdToDelete || isDeletingDraft) return;
    setErrorMessage(null);
    setIsDeletingDraft(true);

    const {
      data: { user },
      error: userError,
    } = await getBrowserAuthUser(supabase);

    if (userError || !user) {
      setIsDeletingDraft(false);
      setErrorMessage("Session invalide.");
      return;
    }

    // Brouillon « fantôme » : UUID uniquement en session, aucune ligne `items` tant que pas de sauvegarde.
    // L’UPDATE ne touche alors aucune ligne (sans erreur PostgREST), et item_intake INSERT échoue sur la FK.
    const { data: updatedRows, error: deleteError } = await supabase
      .from("items")
      .update({
        status: "draft_deleted",
      })
      .eq("id", itemIdToDelete)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null)
      .select("id");

    if (deleteError) {
      setIsDeletingDraft(false);
      setErrorMessage(deleteError.message);
      return;
    }

    setIsDeletingDraft(false);
    sessionStorage.removeItem(ACTIVE_DRAFT_ID_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_SLOTS_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(ITEM_TEXT_DRAFT_STORAGE_KEY);
    clearItemInfoDraft();
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
    setPhotoEditVersion((v) => v + 1);
  };

  const buildPhotosPayload = (slotsWithPaths: Array<ItemPhotoSlot | null>): Record<string, unknown> => {
    const photosPayload: Record<string, unknown> = {};
    for (let index = 0; index < slotsWithPaths.length; index += 1) {
      const slot = slotsWithPaths[index];
      if (!slot?.storagePath) continue;
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
    return photosPayload;
  };

  const uploadSlotsAndBuildPayload = async (): Promise<{ photosPayload: Record<string, unknown>; updatedSlots: Array<ItemPhotoSlot | null> }> => {
    const { data: userData } = await getBrowserAuthUser(supabase);
    if (!userData.user?.id || !draftItemId) throw new Error("Session ou brouillon introuvable.");
    const userId = userData.user.id;
    const bucketId = "bucket_items";
    const updatedSlots: Array<ItemPhotoSlot | null> = [...slots];
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot) continue;
      if (slot.storagePath) continue;
      if (!slot.dataUrl) continue;
      const fileExtension = slot.fileName.includes(".") ? slot.fileName.split(".").pop() || "jpg" : "jpg";
      const normalizedExt = fileExtension.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `users/${userId}/items/${draftItemId}/photo_${index + 1}.${normalizedExt}`;
      const file = await dataUrlToFile(slot.dataUrl, slot.fileName, slot.mimeType);
      const { error } = await supabase.storage.from(bucketId).upload(path, file, {
        upsert: true,
        contentType: file.type || "image/jpeg",
      });
      if (error) throw new Error(error.message);
      updatedSlots[index] = { ...slot, storagePath: path };
    }
    return { photosPayload: buildPhotosPayload(updatedSlots), updatedSlots };
  };

  const clearSlot = (index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return compactSlotsLeft(next);
    });
    setPhotoEditVersion((v) => v + 1);
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
      <header className="fixed left-1/2 top-0 z-50 w-full max-w-[430px] -translate-x-1/2 bg-white pt-5">
        <div className="px-4 pb-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <button type="button" onClick={() => setShowCancelModal(true)} className="justify-self-start px-2 text-[20px] font-bold text-zinc-900">
              Annuler
            </button>
            {isEditValidationMode ? (
              <div className="text-center">
                <h1 className="text-[24px] font-semibold leading-none text-zinc-950">Modification</h1>
                <p className={cn("mt-1 text-[14px] font-semibold", completionScore >= 100 ? "text-zinc-900" : "text-zinc-500")} suppressHydrationWarning>
                  {isInitializingDraft ? "—" : `${completionScore}`} % Terminé
                </p>
              </div>
            ) : (
              <div className="text-center">
                <h1 className="text-[24px] font-semibold leading-none text-zinc-950">New Item</h1>
                <p className={cn("mt-1 text-[14px] font-semibold", completionScore >= 100 ? "text-zinc-900" : "text-zinc-500")} suppressHydrationWarning>
                  {isInitializingDraft ? "—" : `${completionScore}`} % Terminé
                </p>
              </div>
            )}
            <button
              type="submit"
              form={formId}
              disabled={!canSubmit}
              className={cn(
                "justify-self-end px-2 text-[20px] font-bold transition-colors",
                canSubmit ? "text-zinc-900" : "text-zinc-300",
              )}
            >
              {isSubmitting ? "..." : isEditValidationMode ? "Terminer" : "Soumettre"}
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
                mode === "edit" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-300",
              )}
            >
              Modifier
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className={cn(
                "h-12 border-b-2 text-[20px] font-extrabold",
                mode === "view" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-300",
              )}
            >
              Voir
            </button>
          </div>
        </div>
      </header>

      <div className="px-6 pt-[128px]">
      <form id={formId} onSubmit={isEditValidationMode ? onFinish : onSubmit} className="contents">
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
        <div className="space-y-8">
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
                      const returnPathWithParams = requestedItemId && draftItemId ? `/items/new?itemId=${draftItemId}` : "/items/new";
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
                    "group relative aspect-[3/4] overflow-visible rounded-2xl border-2 border-dashed transition",
                    index < 4 ? "border-zinc-300 bg-zinc-50" : "border-zinc-300 bg-white",
                    dragOverIndex === index ? "border-zinc-900 bg-zinc-100" : "",
                    slot ? "cursor-grab touch-none active:cursor-grabbing" : "",
                    draggingIndex === index ? "opacity-30" : "",
                  )}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-[14px]">
                    {slot ? (
                      <>
                        <RemoteCoverThumb
                          photoUrl={slot.dataUrl}
                          frameClassName="h-full w-full"
                          coverStyle={{
                            backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / ITEM_STAGE_RATIO)) * slot.zoom}%`,
                            backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
                            backgroundRepeat: "no-repeat",
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
                          <span className="absolute -bottom-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white">
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
                      className="absolute -left-[7px] -top-[7px] z-[1] inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm opacity-100 transition-opacity duration-150 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100"
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
              <p className={cn(montserrat.className, "-mt-0.5 text-[14px] font-bold leading-none text-zinc-700")}>Ajoute 4 à 6 photos</p>
            </div>
          </section>

          <section className="space-y-4">
            <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-zinc-400")}>Description</p>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Cette description aide à l’évaluation : collection, rareté, spécificités, matière, défauts..."
              className={cn(
                montserratItalic.className,
                "w-full resize-none rounded-xl border border-zinc-200 px-3 py-3 text-[18px] italic leading-[1.08] tracking-[0.01em] text-zinc-900 outline-none placeholder:text-[#c2c2c2] focus:border-zinc-300",
              )}
            />
          </section>

          <section className="space-y-4">
            <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-zinc-400")}>Infos</p>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              {/* replace : une entrée d’historique pour le wizard (pas de chaîne catégorie → couleur → …). */}
              {INFO_LINKS.filter((item) => (item.key === "size" ? showSizeLink : true)).map((item, index) => (
                <Link
                  key={item.key}
                  replace
                  href={
                    requestedItemId && draftItemId
                      ? withFromItemParam(`${item.href}?itemId=${draftItemId}`, searchParams)
                      : item.href
                  }
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
          {errorMessage ? <p className="text-sm text-zinc-600">{errorMessage}</p> : null}
        </div>
        )}
        </div>
      </form>
      </div>
      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[90] h-24 w-24 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/70 shadow-[0_10px_24px_rgba(0,0,0,0.25)]"
          style={{ left: dragPreview.x, top: dragPreview.y }}
          aria-hidden
        >
          <RemoteCoverThumb
            photoUrl={dragPreview.url}
            frameClassName="h-full w-full rounded-xl"
            className="rounded-xl"
            coverStyle={{
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          />
        </div>
      ) : null}
      {showCancelModal ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className={cn(SEGNA_DIALOG_CARD_CLASS, "max-w-[430px]")}>
            <h2 className={segnaDialogTitleClass()}>
              {isEditValidationMode ? "Quitter ?" : "Quitter l'édition ?"}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              {requestedItemId || isEditValidationMode
                ? "Tu peux garder le brouillon, ou annuler les modifications."
                : "Tu peux garder le brouillon, ou supprimer définitivement cet item."}
            </p>
            {errorMessage ? <p className="mt-3 text-sm text-zinc-600">{errorMessage}</p> : null}
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={onKeepDraft}
                disabled={isKeepingDraft}
                className="h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-900 disabled:opacity-60"
              >
                {isKeepingDraft ? "Sauvegarde..." : "Garder le brouillon"}
              </button>
              {requestedItemId || isEditValidationMode ? (
                <button
                  type="button"
                  onClick={onDiscardChanges}
                  className="h-11 rounded-xl bg-zinc-900 text-sm font-semibold text-white"
                >
                  Annuler les modifications
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDeleteDraft}
                  disabled={isDeletingDraft}
                  className="h-11 rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isDeletingDraft ? "Suppression..." : "Supprimer cet item"}
                </button>
              )}
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
