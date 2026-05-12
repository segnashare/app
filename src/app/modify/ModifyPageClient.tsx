"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { PhotoModifyEditor } from "@/components/onboarding/PhotoModifyEditor";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { measureClientPhotoPerf } from "@/lib/perf/client-photo-flow";
import {
  dataUrlToFile,
  getPhotoModifyRuntimeFile,
  preparePhotoModifyImage,
  readPhotoModifyDraft,
  registerPhotoModifyRuntimeFile,
  savePhotoModifyDraft,
  type PhotoModifyDraft,
} from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";



type Offset = { x: number; y: number };

function createUploadObjectPath({
  source,
  userId,
  slot,
  extension,
  itemId,
}: {
  source: PhotoModifyDraft["source"];
  userId: string;
  slot?: number;
  extension: string;
  itemId?: string;
}) {
  const uploadId = `${Date.now()}-${crypto.randomUUID()}`;
  if (source === "looks" && typeof slot === "number") {
    return `users/${userId}/looks/${slot + 1}/${uploadId}.${extension}`;
  }
  if (source === "item" && typeof slot === "number") {
    return `users/${userId}/items/${itemId ?? "draft"}/photo_${slot + 1}_${uploadId}.${extension}`;
  }
  return `users/${userId}/profile/${uploadId}.${extension}`;
}

export function ModifyPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const id = searchParams.get("id") ?? "";

  const [draft, setDraft] = useState<PhotoModifyDraft | null>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    const value = readPhotoModifyDraft(id);
    if (!value) return;
    setDraft(value);
    setOffset(value.offset);
    setZoom(value.zoom);
  }, [id]);

  const navigateBack = (nextDraft: PhotoModifyDraft) => {
    savePhotoModifyDraft(nextDraft);
    const separator = nextDraft.returnPath.includes("?") ? "&" : "?";
    router.push(`${nextDraft.returnPath}${separator}photoModifyId=${encodeURIComponent(nextDraft.id)}`);
  };

  const handleCancel = () => {
    if (!draft) {
      router.back();
      return;
    }
    navigateBack({ ...draft, status: "cancelled" });
  };

  const handleDone = async () => {
    if (!draft) return;
    setErrorMessage(null);
    setIsSaving(true);

    // Pour les items : pas d'upload ici, le dataUrl sera conservé et uploadé à la sauvegarde (Soumettre/Garder)
    // Pour profile/looks : on uploade immédiatement car le flux ne gère pas le différé
    const shouldUploadNow = draft.source !== "item";

    const uploadAtDone = async (): Promise<string | null> => {
      if (!shouldUploadNow) return null;
      if (draft.isRemoteSource) return draft.originalStoragePath ?? null;
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.id) {
        throw new Error("Session introuvable pour uploader la photo.");
      }

      const userId = userData.user.id;
      const fileExtension = draft.fileName.includes(".") ? draft.fileName.split(".").pop() || "jpg" : "jpg";
      const normalizedExt = fileExtension.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const bucketId = draft.source === "item" ? "bucket_items" : "bucket_focus";
      const path = createUploadObjectPath({
        source: draft.source,
        userId,
        slot: draft.slot,
        extension: normalizedExt,
        itemId: draft.itemId,
      });
      const file = getPhotoModifyRuntimeFile(draft.id) ?? await dataUrlToFile(draft.dataUrl, draft.fileName, draft.mimeType);
      const { error: uploadError } = await measureClientPhotoPerf("photo.storageUpload", () =>
        supabase.storage.from(bucketId).upload(path, file, {
          upsert: false,
          cacheControl: "31536000",
          contentType: file.type || "image/jpeg",
        }),
        { source: draft.source, size: file.size },
      );
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      return path;
    };

    let storagePath = shouldUploadNow ? draft.originalStoragePath ?? null : null;
    try {
      const uploaded = await measureClientPhotoPerf("photo.modifyDone", uploadAtDone, { source: draft.source });
      if (uploaded) storagePath = uploaded;
    } catch (error) {
      setIsSaving(false);
      setErrorMessage(error instanceof Error ? error.message : "Impossible d'enregistrer la photo.");
      return;
    }

    navigateBack({
      ...draft,
      originalStoragePath: storagePath ?? undefined,
      offset,
      zoom,
      status: "confirmed",
    });
    setIsSaving(false);
  };

  const handleReplaceImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || !draft) return;

    const prepared = await preparePhotoModifyImage(file);
    const nextDraft: PhotoModifyDraft = {
      ...draft,
      dataUrl: prepared.previewUrl,
      fileName: prepared.fileName || draft.fileName,
      mimeType: prepared.mimeType || draft.mimeType,
      offset: { x: 0, y: 0 },
      zoom: 1,
      status: "pending",
      isRemoteSource: false,
    };

    setDraft(nextDraft);
    setOffset(nextDraft.offset);
    setZoom(nextDraft.zoom);
    registerPhotoModifyRuntimeFile(nextDraft.id, prepared.file, prepared.previewUrl);
    savePhotoModifyDraft(nextDraft);
  };

  if (!draft) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-white px-6">
        <div className="text-center">
          <p className={cn(montserrat.className, "text-zinc-700")}>Photo introuvable.</p>
          <button type="button" onClick={() => router.back()} className="mt-4 text-zinc-900 underline">
            Revenir
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900")} onClick={handleCancel}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[clamp(22px,2vw,26px)] font-bold leading-none text-zinc-900")}>
          Modifie la photo
        </h1>
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900")} onClick={handleDone}>
          {isSaving ? "..." : "Terminé"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-[clamp(20px,6vh,64px)]">
        <div className="overflow-hidden rounded-[18px] border border-zinc-200 bg-white">
          <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={handleReplaceImage} />
          <button
            type="button"
            className="flex w-full items-center justify-between border-b border-zinc-100 px-4 pb-3 pt-3 text-left"
            onClick={() => replaceInputRef.current?.click()}
          >
            <span className={cn(montserrat.className, "text-[24px] font-semibold leading-none text-zinc-900")}>Remplace la photo</span>
            <img src="/ressources/icons/photo_change.svg" alt="" aria-hidden className="h-6 w-6 shrink-0" />
          </button>
          <div>
            <PhotoModifyEditor
              dataUrl={draft.dataUrl}
              aspect={draft.aspect}
              offset={offset}
              zoom={zoom}
              onOffsetChange={setOffset}
              onZoomChange={setZoom}
            />
          </div>
        </div>
      </section>
      {errorMessage ? <p className="mx-auto w-full max-w-[460px] px-4 pb-4 text-[15px] text-[#E44D3E]">{errorMessage}</p> : null}
    </main>
  );
}
