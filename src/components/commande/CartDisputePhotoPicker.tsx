"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const MAX_PHOTOS = 6;

export type CartDisputePhotoDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

type Props = {
  photos: CartDisputePhotoDraft[];
  onChange: (photos: CartDisputePhotoDraft[]) => void;
};

export function CartDisputePhotoPicker({ photos, onChange }: Props) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function appendFiles(files: File[]) {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_PHOTOS - photos.length);
    const selected = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (selected.length === 0) return;

    const next = selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    onChange([...photos, ...next]);
  }

  function removePhoto(id: string) {
    const removed = photos.find((p) => p.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onChange(photos.filter((p) => p.id !== id));
  }

  return (
    <div className="mt-5">
      <p className={cn(segnaMontserrat.className, "mb-2 text-[14px] font-semibold text-zinc-900")}>
        Photos (facultatif)
      </p>
      <p className={cn(segnaMontserrat.className, "mb-2 text-[13px] text-zinc-500")}>
        Jusqu&apos;à {MAX_PHOTOS} photos pour illustrer le problème.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          await appendFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragActive(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragActive(false);
          await appendFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "rounded-xl border-2 border-dashed bg-zinc-50 p-3 transition",
          isDragActive ? "border-zinc-900 bg-zinc-100" : "border-zinc-300",
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50"
            >
              <ImageCoverWithSkeleton
                src={photo.previewUrl}
                alt=""
                className="h-full w-full"
                imgClassName="rounded-lg"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                aria-label="Retirer la photo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-white text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-800"
            >
              <Plus className="h-6 w-6" />
              <span className={cn(segnaMontserrat.className, "text-[11px] font-semibold")}>Ajouter</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
