"use client";

import { measureClientPhotoPerf } from "@/lib/perf/client-photo-flow";

export type PhotoModifySource = "profile" | "looks" | "item";
export type PhotoModifyAspect = "square" | "portrait";

export type PhotoModifyDraft = {
  id: string;
  source: PhotoModifySource;
  returnPath: string;
  dataUrl: string;
  originalStoragePath?: string;
  fileName: string;
  mimeType: string;
  slot?: number;
  itemId?: string;
  aspect: PhotoModifyAspect;
  offset: { x: number; y: number };
  zoom: number;
  status: "pending" | "confirmed" | "cancelled";
  isRemoteSource?: boolean;
};

const keyFor = (id: string) => `segna:photo-modify:${id}`;
const DRAFT_STORAGE_PREFIX = "segna:photo-modify:";
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.86;
/** Brouillon new item (sessionStorage) : plus léger pour éviter le quota mobile (~5 Mo). */
const ITEM_DRAFT_MAX_IMAGE_SIDE = 1080;
const ITEM_DRAFT_JPEG_QUALITY = 0.72;

type ImageNormalizeOptions = {
  maxSide?: number;
  quality?: number;
};

const runtimeFiles = new Map<string, File>();
const runtimeObjectUrls = new Map<string, string>();

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image"));
    image.src = src;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

const normalizedImageBlobForStorage = async (src: string, options?: ImageNormalizeOptions) => {
  const maxSide = options?.maxSide ?? MAX_IMAGE_SIDE;
  const quality = options?.quality ?? JPEG_QUALITY;
  const image = await loadImage(src);
  const largestSide = Math.max(image.width, image.height, 1);
  const scale = Math.min(1, maxSide / largestSide);
  const outputWidth = Math.max(1, Math.round(image.width * scale));
  const outputHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, outputWidth, outputHeight);
  return canvasToBlob(canvas, quality);
};

const normalizeDataUrlForStorage = async (dataUrl: string, options?: ImageNormalizeOptions) => {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  const blob = await normalizedImageBlobForStorage(dataUrl, options);
  if (!blob) return dataUrl;
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read normalized image"));
    reader.readAsDataURL(blob);
  });
};

/** Compression dédiée aux brouillons pièce (4–6 photos en sessionStorage). */
export async function compressDataUrlForItemDraft(dataUrl: string): Promise<string> {
  return normalizeDataUrlForStorage(dataUrl, {
    maxSide: ITEM_DRAFT_MAX_IMAGE_SIDE,
    quality: ITEM_DRAFT_JPEG_QUALITY,
  });
}

export function purgeStalePhotoModifyDraftsFromSession(keepId?: string): void {
  const keysToDelete: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(DRAFT_STORAGE_PREFIX) && key !== (keepId ? keyFor(keepId) : undefined)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach((key) => window.sessionStorage.removeItem(key));
}

export const fileToDataUrl = (file: File) =>
  measureClientPhotoPerf("photo.fileToDataUrl", () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const rawDataUrl = String(reader.result ?? "");
          const normalized = await normalizeDataUrlForStorage(rawDataUrl);
          resolve(normalized);
        } catch {
          resolve(String(reader.result ?? ""));
        }
      };
      reader.onerror = () => reject(new Error("Unable to read file"));
      reader.readAsDataURL(file);
    }),
  );

export async function preparePhotoModifyImage(file: File, options?: { forItemDraft?: boolean }) {
  const normalizeOpts: ImageNormalizeOptions | undefined = options?.forItemDraft
    ? { maxSide: ITEM_DRAFT_MAX_IMAGE_SIDE, quality: ITEM_DRAFT_JPEG_QUALITY }
    : undefined;

  return measureClientPhotoPerf(
    "photo.prepareLocalFile",
    async () => {
      const sourceUrl = URL.createObjectURL(file);
      try {
        const blob = await normalizedImageBlobForStorage(sourceUrl, normalizeOpts);
        const normalizedName = (file.name || "photo.jpg").replace(/\.[^.]+$/, "") || "photo";
        const normalizedFile =
          blob && blob.size > 0
            ? new File([blob], `${normalizedName}.jpg`, { type: "image/jpeg" })
            : file;
        const previewUrl = URL.createObjectURL(normalizedFile);
        return {
          file: normalizedFile,
          previewUrl,
          fileName: normalizedFile.name || file.name || "photo.jpg",
          mimeType: normalizedFile.type || file.type || "image/jpeg",
        };
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    },
    { size: file.size },
  );
}

export function registerPhotoModifyRuntimeFile(id: string, file: File, objectUrl?: string) {
  runtimeFiles.set(id, file);
  if (objectUrl) {
    const previousUrl = runtimeObjectUrls.get(id);
    if (previousUrl && previousUrl !== objectUrl) URL.revokeObjectURL(previousUrl);
    runtimeObjectUrls.set(id, objectUrl);
  }
}

export function getPhotoModifyRuntimeFile(id: string) {
  return runtimeFiles.get(id) ?? null;
}

export function clearPhotoModifyRuntime(id: string, options?: { revokeObjectUrl?: boolean }) {
  runtimeFiles.delete(id);
  const objectUrl = runtimeObjectUrls.get(id);
  if (objectUrl && options?.revokeObjectUrl) URL.revokeObjectURL(objectUrl);
  runtimeObjectUrls.delete(id);
}

export const dataUrlToFile = async (dataUrl: string, fileName: string, mimeType: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: mimeType || blob.type || "image/jpeg" });
};

export async function savePhotoModifyDraft(draft: PhotoModifyDraft): Promise<void> {
  let payload = draft;
  if (draft.source === "item" && draft.dataUrl.startsWith("data:image/")) {
    try {
      const dataUrl = await compressDataUrlForItemDraft(draft.dataUrl);
      payload = { ...draft, dataUrl, mimeType: "image/jpeg" };
    } catch {
      // Garde l’original si la compression échoue.
    }
  }

  const write = (serialized: string) => {
    window.sessionStorage.setItem(keyFor(draft.id), serialized);
  };

  purgeStalePhotoModifyDraftsFromSession(draft.id);

  try {
    write(JSON.stringify(payload));
    return;
  } catch {
    // ignore
  }

  try {
    write(JSON.stringify(payload));
  } catch {
    throw new Error("Stockage local saturé, choisis une image plus légère.");
  }
}

export const readPhotoModifyDraft = (id: string) => {
  const raw = window.sessionStorage.getItem(keyFor(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PhotoModifyDraft;
  } catch {
    return null;
  }
};

export const removePhotoModifyDraft = (id: string) => {
  window.sessionStorage.removeItem(keyFor(id));
  clearPhotoModifyRuntime(id);
};
