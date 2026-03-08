"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Image as ImageIcon, Minus, Plus } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type OnboardingProfileCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

type PhotoOffset = {
  x: number;
  y: number;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.5;

function clampOffset(offset: PhotoOffset, limits: PhotoOffset): PhotoOffset {
  return {
    x: Math.min(limits.x, Math.max(-limits.x, offset.x)),
    y: Math.min(limits.y, Math.max(-limits.y, offset.y)),
  };
}

export function OnboardingProfileCore({ formId, onCanContinueChange }: OnboardingProfileCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [photoOffset, setPhotoOffset] = useState<PhotoOffset>({ x: 0, y: 0 });
  const [photoZoom, setPhotoZoom] = useState(1);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editorPreviewUrl, setEditorPreviewUrl] = useState<string | null>(null);
  const [editorOffset, setEditorOffset] = useState<PhotoOffset>({ x: 0, y: 0 });
  const [editorZoom, setEditorZoom] = useState(1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorStageRef = useRef<HTMLDivElement | null>(null);
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);

  const canContinue = Boolean(selectedFile) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  useEffect(() => {
    if (!editorFile) {
      setEditorPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(editorFile);
    setEditorPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [editorFile]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedFile) {
      setErrorMessage("Ajoute une photo de profil pour continuer.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/style",
      p_progress: { checkpoint: "/onboarding/profile", profile_photo_selected: true, profile_photo_name: selectedFile.name },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/style");
  };

  const openEditor = (file: File, initialOffset: PhotoOffset) => {
    setEditorFile(file);
    setEditorOffset(initialOffset);
    setEditorZoom(photoZoom);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditorFile(null);
    dragPointerRef.current = null;
  };

  const handlePickedFile = (file: File | null, initialOffset: PhotoOffset = { x: 0, y: 0 }) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Le fichier doit être une image.");
      return;
    }
    setErrorMessage(null);
    openEditor(file, initialOffset);
  };

  const handleEditorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragPointerRef.current || !editorStageRef.current || !editorFrameRef.current) return;
    const stageWidth = Math.max(editorStageRef.current.clientWidth, 1);
    const stageHeight = Math.max(editorStageRef.current.clientHeight, 1);
    const frameWidth = editorFrameRef.current.clientWidth;
    const frameHeight = editorFrameRef.current.clientHeight;

    const limits = {
      x: ((stageWidth - frameWidth) / 2 / stageWidth) * 100,
      y: ((stageHeight - frameHeight) / 2 / stageHeight) * 100,
    };
    const deltaXPercent = ((event.clientX - dragPointerRef.current.x) / stageWidth) * 100;
    const deltaYPercent = ((event.clientY - dragPointerRef.current.y) / stageHeight) * 100;

    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    setEditorOffset((prev) => clampOffset({ x: prev.x + deltaXPercent, y: prev.y + deltaYPercent }, limits));
  };

  const handleEditorPointerUp = () => {
    dragPointerRef.current = null;
  };

  const handleEditorConfirm = () => {
    if (!editorFile) return;
    setSelectedFile(editorFile);
    setPhotoOffset({ x: -editorOffset.x, y: -editorOffset.y });
    setPhotoZoom(editorZoom);
    closeEditor();
  };

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-6">
        <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,18px)] leading-[1.25] text-zinc-500")}>
          Choisis une photo claire où ton visage est visible.
        </p>

        <div className="flex flex-col items-start gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Ajouter une photo de profil"
            onClick={() => {
              if (selectedFile && previewUrl) {
                openEditor(selectedFile, { x: -photoOffset.x, y: -photoOffset.y });
                return;
              }
              fileInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (selectedFile && previewUrl) {
                  openEditor(selectedFile, { x: -photoOffset.x, y: -photoOffset.y });
                } else {
                  fileInputRef.current?.click();
                }
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              handlePickedFile(event.dataTransfer.files?.[0] ?? null, { x: 0, y: 0 });
            }}
            className={cn(
              "relative aspect-square w-full max-w-[320px] cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed bg-[#f7f3ef] transition",
              isDragActive ? "border-[#5E3023] bg-[#f3ece5]" : "border-[#5E3023]/55",
            )}
          >
            {previewUrl ? (
              <>
                <div
                  className="h-full w-full bg-center bg-no-repeat"
                  style={{
                    backgroundImage: `url(${previewUrl})`,
                    backgroundColor: "#000000",
                    backgroundSize: `${Math.max(55, photoZoom * 100)}%`,
                    backgroundPosition: `calc(50% + ${photoOffset.x}%) calc(50% + ${photoOffset.y}%)`,
                  }}
                />
                <div className="absolute inset-0 bg-black/15" />
                <span
                  className={cn(
                    montserrat.className,
                    "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-[12px] font-semibold text-zinc-800",
                  )}
                >
                  Modifier
                </span>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="relative inline-flex items-center justify-center">
                  <ImageIcon size={44} className="text-zinc-400" />
                  <span className="absolute -bottom-2 -right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#5E3023] text-white">
                    <Plus size={16} strokeWidth={3} />
                  </span>
                </div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            id="profilePhoto"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              handlePickedFile(event.target.files?.[0] ?? null, { x: 0, y: 0 });
            }}
          />

          {selectedFile ? (
            <p className={cn(montserrat.className, "max-w-[320px] text-[13px] text-zinc-500")}>{selectedFile.name}</p>
          ) : (
            <p className={cn(montserrat.className, "max-w-[320px] text-[13px] text-zinc-500")}>Clique ou glisse-dépose ta photo.</p>
          )}
        </div>
      </form>

      {errorMessage ? <p className="mt-3 text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}

      {isEditorOpen && editorPreviewUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-[0_16px_46px_rgba(0,0,0,0.28)]">
            <div className="px-5 pb-4 pt-5">
              <p className={cn(montserrat.className, "mb-4 text-[18px] font-semibold text-zinc-900")}>Ajuste ta photo</p>
              <div
                ref={editorStageRef}
                className="relative h-[420px] w-full overflow-hidden rounded-xl"
                style={{
                  backgroundImage: `url(${editorPreviewUrl})`,
                  backgroundColor: "#000000",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: `${Math.max(55, editorZoom * 100)}%`,
                  backgroundPosition: "50% 50%",
                }}
              >
                <div className="absolute inset-0 bg-black/28" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    ref={editorFrameRef}
                    className="absolute aspect-square w-[min(84vw,320px)] overflow-hidden rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(24,24,27,0.22)]"
                    onPointerDown={handleEditorPointerDown}
                    onPointerMove={handleEditorPointerMove}
                    onPointerUp={handleEditorPointerUp}
                    onPointerCancel={handleEditorPointerUp}
                    style={{
                      left: "50%",
                      top: "50%",
                      transform: `translate(calc(-50% + ${editorOffset.x}%), calc(-50% + ${editorOffset.y}%))`,
                    }}
                  />
                </div>

              </div>

              <div className="mt-3 flex items-center justify-center">
                <div className="flex items-center gap-3 rounded-full bg-white/95 px-3 py-2 shadow">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"
                    onClick={() => setEditorZoom((prev) => Math.max(MIN_ZOOM, Number((prev - 0.1).toFixed(2))))}
                    aria-label="Dézoomer"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={editorZoom}
                    onChange={(event) => setEditorZoom(Number(event.target.value))}
                    className="w-[140px] accent-[#5E3023]"
                    aria-label="Niveau de zoom"
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"
                    onClick={() => setEditorZoom((prev) => Math.min(MAX_ZOOM, Number((prev + 0.1).toFixed(2))))}
                    aria-label="Zoomer"
                  >
                    <Plus size={14} />
                  </button>
                  <span className={cn(montserrat.className, "min-w-[38px] text-right text-[12px] font-semibold text-zinc-600")}>
                    {Math.round(editorZoom * 100)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex h-[74px] border-t border-zinc-200">
              <button
                type="button"
                className={cn(montserrat.className, "h-full flex-1 text-[17px] font-medium text-zinc-700")}
                onClick={closeEditor}
              >
                Annuler
              </button>
              <div className="w-px bg-zinc-200" aria-hidden />
              <button
                type="button"
                className={cn(montserrat.className, "h-full flex-1 text-[17px] font-semibold text-[#5E3023]")}
                onClick={handleEditorConfirm}
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
