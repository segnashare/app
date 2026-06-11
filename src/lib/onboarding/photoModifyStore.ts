"use client";

import { measureClientPhotoPerf } from "@/lib/perf/client-photo-flow";

export type PhotoModifySource = "profile" | "looks" | "item";
export type PhotoModifyAspect = "square" | "portrait" | "landscape";

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

/** Impossible d’enregistrer la photo avant l’écran de recadrage (sessionStorage plein). */
export const ITEM_PHOTO_STORAGE_QUOTA_MESSAGE =
  "Le navigateur n’a plus assez de place pour enregistrer cette photo (souvent à partir de la 4ᵉ image ou avec des fichiers très lourds). Réessaie avec une photo plus légère (JPEG, moins de 2 Mo), ou ferme d’autres onglets Segna.";

/** Retour depuis /modify : brouillon photo introuvable (quota ou onglet fermé). */
export const ITEM_PHOTO_RETURN_LOST_MESSAGE =
  "La photo validée n’a pas pu être récupérée : la mémoire locale du navigateur est saturée ou la session a expiré. Réessaie avec une image plus légère ou ferme d’autres onglets Segna.";

/** Les slots restent à l’écran mais ne peuvent plus être mémorisés entre deux étapes. */
export const ITEM_SLOTS_PERSIST_QUOTA_MESSAGE =
  "Tes photos restent visibles à l’écran, mais le navigateur n’a plus assez de place pour les mémoriser localement. Évite de quitter la page avant d’avoir validé la fiche, ou utilise des photos plus légères.";

export const ITEM_PHOTO_PREPARE_FAILED_MESSAGE =
  "Impossible de préparer cette photo. Choisis un fichier JPEG ou PNG plus léger, puis réessaie.";

export const ITEM_PHOTO_SLOT_INVALID_MESSAGE =
  "Impossible d’ajouter la photo à cet emplacement. Touche à nouveau une case photo vide, puis réessaie.";

export function isItemPhotoStorageQuotaError(message: string): boolean {
  return (
    message.includes("Stockage local saturé") ||
    message.includes("plus assez de place") ||
    message.includes("mémoire locale")
  );
}
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.86;
/** Brouillon pièce (sessionStorage) : plus léger pour limiter le quota mobile. */
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

export const savePhotoModifyDraft = (draft: PhotoModifyDraft) => {
  const serialized = JSON.stringify(draft);
  try {
    window.sessionStorage.setItem(keyFor(draft.id), serialized);
    return;
  } catch {}

  // Best effort cleanup: remove older draft keys and retry once.
  const keysToDelete: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(DRAFT_STORAGE_PREFIX) && key !== keyFor(draft.id)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach((key) => window.sessionStorage.removeItem(key));

  try {
    window.sessionStorage.setItem(keyFor(draft.id), serialized);
  } catch {
    throw new Error(ITEM_PHOTO_STORAGE_QUOTA_MESSAGE);
  }
};

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
