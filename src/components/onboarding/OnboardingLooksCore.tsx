"use client";

import { Montserrat } from "next/font/google";
import { Image as ImageIcon, Lightbulb, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  fileToDataUrl,
  readPhotoModifyDraft,
  removePhotoModifyDraft,
  savePhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";

type OnboardingLooksCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const LOOK_STAGE_RATIO = 1;
const LOOKS_DRAFT_STORAGE_KEY = "segna:onboarding:looks:draft";

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

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingLooksCore({ formId, onCanContinueChange }: OnboardingLooksCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSlotRef = useRef(0);

  type LookSlot = {
    dataUrl: string;
    fileName: string;
    mimeType: string;
    storagePath?: string;
    imageRatio: number;
    offset: { x: number; y: number };
    zoom: number;
  };

  const [slots, setSlots] = useState<Array<LookSlot | null>>([null, null, null]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);

  const canContinue = !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(LOOKS_DRAFT_STORAGE_KEY);
    if (!raw) {
      setHasHydratedDraft(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Array<LookSlot | null>;
      if (Array.isArray(parsed) && parsed.length === 3) {
        setSlots(parsed);
      }
    } catch {
      // Ignore malformed draft and continue with empty state.
    }
    setHasHydratedDraft(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedDraft) return;
    window.sessionStorage.setItem(LOOKS_DRAFT_STORAGE_KEY, JSON.stringify(slots));
  }, [hasHydratedDraft, slots]);

  useEffect(() => {
    if (!hasHydratedDraft) return;
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || draft.source !== "looks" || draft.status !== "confirmed") return;
    if (typeof draft.slot !== "number" || draft.slot < 0 || draft.slot > 2) return;

    void (async () => {
      const imageRatio = await getImageRatio(draft.dataUrl);
      setSlots((prev) => {
        const next = [...prev];
        next[draft.slot as number] = {
          dataUrl: draft.dataUrl,
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          storagePath: draft.originalStoragePath,
          imageRatio,
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        };
        return next;
      });
      removePhotoModifyDraft(modifiedId);
      router.replace("/onboarding/looks");
    })();
  }, [hasHydratedDraft, router, searchParams]);

  const openPickerForSlot = (index: number) => {
    activeSlotRef.current = index;
    fileInputRef.current?.click();
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const slotIndex = activeSlotRef.current;
    const dataUrl = await fileToDataUrl(file);
    const draftId = crypto.randomUUID();
    try {
      savePhotoModifyDraft({
        id: draftId,
        source: "looks",
        returnPath: "/onboarding/looks",
        dataUrl,
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
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
    event.target.value = "";
  };

  const onDropSlot = (targetIndex: number) => {
    if (draggingIndex === null || draggingIndex === targetIndex) return;
    setSlots((prev) => {
      const next = [...prev];
      const temp = next[targetIndex];
      next[targetIndex] = next[draggingIndex];
      next[draggingIndex] = temp;
      return next;
    });
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const missingStoragePath = slots.some((slot) => slot && !slot.storagePath);
    if (missingStoragePath) {
      setErrorMessage("Certaines photos ne sont pas encore enregistrées. Ouvre-les puis valide avec \"Terminé\".");
      return;
    }

    const looksPayload = slots.reduce<Record<string, unknown>>((accumulator, slot, index) => {
      if (!slot) return accumulator;
      const key = `look${index + 1}`;
      accumulator[key] = {
        url: slot.storagePath ?? null,
        storage_path: slot.storagePath ?? null,
        position: {
          offset: slot.offset,
          zoom: slot.zoom,
          aspect: "square",
        },
      };
      return accumulator;
    }, {});

    setIsSubmitting(true);
    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        looks: looksPayload,
      },
      p_request_id: crypto.randomUUID(),
    });
    if (profileError) {
      setIsSubmitting(false);
      setErrorMessage(profileError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/answers",
      p_progress_json: {
        checkpoint: "/onboarding/looks",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    window.sessionStorage.removeItem(LOOKS_DRAFT_STORAGE_KEY);
    router.push("/onboarding/answers");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5">
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />

        <div className="grid grid-cols-3 gap-2">
          {slots.map((slot, index) => (
            <button
              key={`look-slot-${index}`}
              type="button"
              draggable={Boolean(slot)}
              onDragStart={() => setDraggingIndex(index)}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDragOverIndex(null);
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
              onDragEnter={() => setDragOverIndex(index)}
              onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
              onDrop={() => onDropSlot(index)}
              onClick={() => {
                if (slot) {
                  const draftId = crypto.randomUUID();
                  try {
                    savePhotoModifyDraft({
                      id: draftId,
                      source: "looks",
                      returnPath: "/onboarding/looks",
                      dataUrl: slot.dataUrl,
                      originalStoragePath: slot.storagePath,
                      fileName: slot.fileName,
                      mimeType: slot.mimeType,
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
                "relative aspect-square overflow-hidden rounded-2xl border-2 border-dashed bg-[#f7f3ef] transition",
                dragOverIndex === index ? "border-[#5E3023] bg-[#f3ece5]" : "border-[#5E3023]/55",
              )}
            >
              {slot ? (
                <div
                  className="h-full w-full bg-center bg-no-repeat"
                  style={{
                    backgroundColor: "#000000",
                    backgroundImage: `url(${slot.dataUrl})`,
                    backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / LOOK_STAGE_RATIO)) * slot.zoom}%`,
                    backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="relative inline-flex items-center justify-center">
                    <ImageIcon size={32} className="text-zinc-400" />
                    <span className="absolute -bottom-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5E3023] text-white">
                      <Plus size={14} strokeWidth={3} />
                    </span>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>

        <div>
          <p className={cn(montserrat.className, "text-[clamp(12px,2.2vw,14px)] italic text-[#b3b3b3]")}>Fais glisser pour réorganiser</p>
          <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-[#5E3023]")}>Ajoute 1 à 3 photos</p>
        </div>

        <div className="relative rounded-[14px] border border-zinc-200 bg-transparent px-4 pb-4 pt-6">
          <div className="absolute -top-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center justify-center rounded-full bg-[#f9f9f8] p-1">
            <Lightbulb className="h-5 w-5 text-zinc-500" strokeWidth={1.8} aria-hidden />
          </div>
          <p className={cn(montserrat.className, "text-center text-[clamp(14px,2.7vw,22px)] leading-[1.1] text-zinc-900")}>
            Ajoute 3 looks type OOTD où l&apos;on te voit <span className="text-[#5E3023]">seule avec ta tenue.</span>
          </p>
        </div>
      </form>

      {errorMessage ? <p className="mt-3 text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}

    </div>
  );
}
