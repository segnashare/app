"use client";

import { Montserrat } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PhotoModifyEditor } from "@/components/onboarding/PhotoModifyEditor";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dataUrlToFile, fileToDataUrl, readPhotoModifyDraft, savePhotoModifyDraft, type PhotoModifyDraft } from "@/lib/onboarding/photoModifyStore";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

type Offset = { x: number; y: number };

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

    const uploadAtDone = async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.id) {
        throw new Error("Session introuvable pour uploader la photo.");
      }

      const userId = userData.user.id;
      const path =
        draft.source === "looks" && typeof draft.slot === "number"
          ? `users/${userId}/looks/${draft.slot + 1}/original.jpg`
          : `users/${userId}/profile/original.jpg`;
      const file = await dataUrlToFile(draft.dataUrl, draft.fileName, draft.mimeType);
      const { error: uploadError } = await supabase.storage.from("bucket_focus").upload(path, file, {
        upsert: true,
        contentType: file.type || "image/jpeg",
      });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      return path;
    };

    let storagePath = draft.originalStoragePath ?? null;
    try {
      storagePath = await uploadAtDone();
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

    const nextDataUrl = await fileToDataUrl(file);
    const nextDraft: PhotoModifyDraft = {
      ...draft,
      dataUrl: nextDataUrl,
      fileName: file.name || draft.fileName,
      mimeType: file.type || draft.mimeType,
      offset: { x: 0, y: 0 },
      zoom: 1,
      status: "pending",
    };

    setDraft(nextDraft);
    setOffset(nextDraft.offset);
    setZoom(nextDraft.zoom);
    savePhotoModifyDraft(nextDraft);
  };

  if (!draft) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-white px-6">
        <div className="text-center">
          <p className={cn(montserrat.className, "text-zinc-700")}>Photo introuvable.</p>
          <button type="button" onClick={() => router.back()} className="mt-4 text-[#5E3023] underline">
            Revenir
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={handleCancel}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[clamp(22px,2vw,26px)] font-bold leading-none text-zinc-900")}>
          Modifie la photo
        </h1>
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={handleDone}>
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
