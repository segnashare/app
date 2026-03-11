"use client";

import { Montserrat } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  dataUrlToFile,
  fileToDataUrl,
  readPhotoModifyDraft,
  removePhotoModifyDraft,
  savePhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
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

export function OnboardingProfileCore({ formId, onCanContinueChange }: OnboardingProfileCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [profilePhotoPath, setProfilePhotoPath] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [photoOffset, setPhotoOffset] = useState<PhotoOffset>({ x: 0, y: 0 });
  const [photoZoom, setPhotoZoom] = useState(1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canContinue = !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    const draft = readPhotoModifyDraft(modifiedId);
    if (!draft || draft.source !== "profile" || draft.status !== "confirmed") return;

    void (async () => {
      const file = await dataUrlToFile(draft.dataUrl, draft.fileName, draft.mimeType);
      setSelectedFile(file);
      setPreviewDataUrl(draft.dataUrl);
      setPhotoOffset({ x: draft.offset.x, y: draft.offset.y });
      setPhotoZoom(draft.zoom);
      setProfilePhotoPath(draft.originalStoragePath ?? null);
      removePhotoModifyDraft(modifiedId);
      router.replace("/onboarding/profile");
    })();
  }, [router, searchParams]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    setIsSubmitting(true);
    if (selectedFile) {
      const profileTransform = {
        offset: { x: photoOffset.x, y: photoOffset.y },
        zoom: photoZoom,
        aspect: "square",
      };
      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          photos: {
            profile_photo_selected: true,
            profile_photo_name: selectedFile.name,
            profile_photo_path: profilePhotoPath,
            profile_photo_transform: profileTransform,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (profileError) {
        setIsSubmitting(false);
        setErrorMessage(profileError.message);
        return;
      }
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/style",
      p_progress_json: { checkpoint: "/onboarding/profile" },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/style");
  };

  const openModifyPage = async (
    file: File,
    dataUrl: string,
    initialOffset: PhotoOffset = { x: 0, y: 0 },
    originalStoragePath?: string,
  ) => {
    const draftId = crypto.randomUUID();
    try {
      savePhotoModifyDraft({
        id: draftId,
        source: "profile",
        returnPath: "/onboarding/profile",
        dataUrl,
        originalStoragePath,
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        aspect: "square",
        offset: initialOffset,
        zoom: photoZoom,
        status: "pending",
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Impossible de préparer la photo.");
      return;
    }
    router.push(`/modify?id=${encodeURIComponent(draftId)}`);
  };

  const handlePickedFile = async (file: File | null, initialOffset: PhotoOffset = { x: 0, y: 0 }) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Le fichier doit être une image.");
      return;
    }
    setErrorMessage(null);
    const dataUrl = await fileToDataUrl(file);
    await openModifyPage(file, dataUrl, initialOffset, profilePhotoPath ?? undefined);
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
              if (selectedFile && previewDataUrl) {
                void openModifyPage(selectedFile, previewDataUrl, { x: photoOffset.x, y: photoOffset.y }, profilePhotoPath ?? undefined);
                return;
              }
              fileInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (selectedFile && previewDataUrl) {
                  void openModifyPage(selectedFile, previewDataUrl, { x: photoOffset.x, y: photoOffset.y }, profilePhotoPath ?? undefined);
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
              void handlePickedFile(event.dataTransfer.files?.[0] ?? null, { x: 0, y: 0 });
            }}
            className={cn(
              "relative aspect-square w-full max-w-[320px] cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed bg-[#f7f3ef] transition",
              isDragActive ? "border-[#5E3023] bg-[#f3ece5]" : "border-[#5E3023]/55",
            )}
          >
            {previewDataUrl ? (
              <>
                <div
                  className="h-full w-full bg-center bg-no-repeat"
                  style={{
                    backgroundImage: `url(${previewDataUrl})`,
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
              void handlePickedFile(event.target.files?.[0] ?? null, { x: 0, y: 0 });
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
    </div>
  );
}
