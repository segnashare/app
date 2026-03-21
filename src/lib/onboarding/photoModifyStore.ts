"use client";

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
};

const keyFor = (id: string) => `segna:photo-modify:${id}`;
const DRAFT_STORAGE_PREFIX = "segna:photo-modify:";
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.86;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image"));
    image.src = src;
  });

const normalizeDataUrlForStorage = async (dataUrl: string) => {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  const image = await loadImage(dataUrl);
  const largestSide = Math.max(image.width, image.height, 1);
  const scale = Math.min(1, MAX_IMAGE_SIDE / largestSide);
  const outputWidth = Math.max(1, Math.round(image.width * scale));
  const outputHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, outputWidth, outputHeight);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
};

export const fileToDataUrl = (file: File) =>
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
  });

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
    throw new Error("Stockage local saturé, choisis une image plus légère.");
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
};
