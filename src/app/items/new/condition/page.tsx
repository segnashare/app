"use client";

import { Montserrat } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { StyleAdditionalInput } from "@/components/onboarding/StyleAdditionalInput";
import { fileToDataUrl } from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";

const OPTIONS = ["Neuf avec étiquette", "Excellent état", "Très bon état", "Bon état"];
const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const DEFECT_PHOTOS_STORAGE_PREFIX = "segna:new-item:condition-defect-photos:";
const ACTIVE_DRAFT_ID_STORAGE_KEY = "segna:new-item:active-draft-id";

function getDefectPhotosStorageKey(itemId: string | null): string {
  return `${DEFECT_PHOTOS_STORAGE_PREFIX}${itemId?.trim() || "anonymous"}`;
}

type DefectPhoto = {
  id: string;
  fileName: string;
  dataUrl: string;
};

export default function NewItemConditionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemIdFromUrl = searchParams.get("itemId")?.trim() || null;
  const [effectiveItemId, setEffectiveItemId] = useState<string | null>(itemIdFromUrl);
  const [defectPhotos, setDefectPhotos] = useState<DefectPhoto[]>([]);
  const [hasHydratedPhotos, setHasHydratedPhotos] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detailsTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const initialConditionDetails = searchParams.get("conditionDetails") ?? "";
  const [selected, setSelected] = useState(searchParams.get("condition") ?? "");
  const [conditionDetails, setConditionDetails] = useState(initialConditionDetails);

  useEffect(() => {
    const resolvedItemId = itemIdFromUrl || sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY) || null;
    setEffectiveItemId(resolvedItemId);
    const key = getDefectPhotosStorageKey(resolvedItemId);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as DefectPhoto[];
        if (Array.isArray(parsed)) {
          const safe = parsed.filter((entry) => entry && typeof entry.id === "string" && typeof entry.dataUrl === "string").slice(0, 8);
          setDefectPhotos(safe);
        }
      }
    } catch {
      // Ignore malformed local state.
    }
    setHasHydratedPhotos(true);
  }, [itemIdFromUrl]);

  const storageKey = getDefectPhotosStorageKey(effectiveItemId);

  useEffect(() => {
    if (!hasHydratedPhotos) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(defectPhotos));
    } catch {
      // Best effort only.
    }
  }, [hasHydratedPhotos, storageKey, defectPhotos]);

  const goBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const goBackWithValue = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (effectiveItemId) params.set("itemId", effectiveItemId);
    params.set("condition", value);
    const trimmedDetails = conditionDetails.trim();
    if (trimmedDetails.length > 0) {
      params.set("conditionDetails", trimmedDetails);
    } else if (initialConditionDetails.length > 0) {
      params.delete("conditionDetails");
    }
    params.set("conditionDefectPhotoCount", String(defectPhotos.length));
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const appendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const roomLeft = Math.max(0, 8 - defectPhotos.length);
    if (roomLeft <= 0) return;
    const selectedFiles = files.filter((file) => file.type.startsWith("image/")).slice(0, roomLeft);
    if (selectedFiles.length === 0) return;

    const converted = await Promise.all(
      selectedFiles.map(async (file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        dataUrl: await fileToDataUrl(file),
      })),
    );
    setDefectPhotos((prev) => [...prev, ...converted]);
  };

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>État</h1>
        <button
          type="button"
          className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023] disabled:opacity-40")}
          disabled={!selected}
          onClick={() => goBackWithValue(selected)}
        >
          Terminé
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          <p className={cn(montserrat.className, "mb-2 mt-4 text-[14px] text-zinc-500")}>Sélectionne l&apos;état de ta pièce.</p>

          <div className="space-y-0.5">
          {OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelected(option)}
              className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
              aria-pressed={selected === option}
            >
              <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{option}</span>
              <span
                className={cn(
                  "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center border",
                  selected === option ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                )}
                aria-hidden
              >
                <Check size={15} strokeWidth={3} />
              </span>
            </button>
          ))}
          </div>

          <div className="mt-6">
            <StyleAdditionalInput
              value={conditionDetails}
              onChange={setConditionDetails}
              onAddClick={() => detailsTextareaRef.current?.focus()}
              textareaRef={detailsTextareaRef}
              placeholder="Plus de détails sur l'état, défauts, usure..."
              containerClassName="border-[#5E3023]/55"
            />
          </div>

          <div className="mt-5">
            <p className={cn(montserrat.className, "mb-2 text-[14px] text-zinc-500")}>Photos des défauts</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (event) => {
                const next = Array.from(event.target.files ?? []);
                await appendFiles(next);
                event.target.value = "";
              }}
            />
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsDragActive(false);
                }
              }}
              onDrop={async (event) => {
                event.preventDefault();
                setIsDragActive(false);
                const files = event.dataTransfer.files;
                if (!files?.length) return;
                await appendFiles(Array.from(files));
              }}
              className={cn(
                "rounded-xl border-2 border-dashed bg-[#f7f3ef] p-3 transition",
                isDragActive ? "border-[#5E3023] bg-[#f3ece5]" : "border-[#5E3023]/55",
              )}
            >
              <div className="grid grid-cols-3 gap-2">
                {defectPhotos.map((photo) => (
                  <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50">
                    <img src={photo.dataUrl} alt={photo.fileName} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDefectPhotos((prev) => prev.filter((entry) => entry.id !== photo.id));
                      }}
                      className="absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                      aria-label={`Supprimer ${photo.fileName}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {defectPhotos.length < 8 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }}
                    className="aspect-square rounded-lg border-2 border-dashed border-[#5E3023]/55 bg-[#f7f3ef] transition hover:border-[#5E3023] hover:bg-[#f3ece5]"
                    aria-label="Ajouter une photo"
                  >
                    <Plus size={28} strokeWidth={2} className="mx-auto text-zinc-500" />
                  </button>
                ) : null}
              </div>
              <p className={cn(montserrat.className, "mt-3 text-center text-[13px] text-zinc-500")}>
                Tu peux glisser-déposer de nouvelles photos ici
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
