export type InspirationCoverAspect = "landscape" | "portrait" | "square";

export type InspirationCoverTransform = {
  offset: { x: number; y: number };
  zoom: number;
};

export const DEFAULT_INSPIRATION_COVER_TRANSFORM: InspirationCoverTransform = {
  offset: { x: 0, y: 0 },
  zoom: 1,
};

export function parseInspirationCoverAspect(raw: unknown): InspirationCoverAspect {
  if (raw === "landscape" || raw === "square" || raw === "portrait") return raw;
  return "portrait";
}

export function parseInspirationCoverTransform(raw: unknown): InspirationCoverTransform | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const offsetRaw = row.offset;
  if (!offsetRaw || typeof offsetRaw !== "object" || Array.isArray(offsetRaw)) return null;
  const offsetObj = offsetRaw as Record<string, unknown>;
  const x = typeof offsetObj.x === "number" ? offsetObj.x : Number(offsetObj.x);
  const y = typeof offsetObj.y === "number" ? offsetObj.y : Number(offsetObj.y);
  const zoomRaw = typeof row.zoom === "number" ? row.zoom : Number(row.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoomRaw)) return null;
  return {
    offset: { x, y },
    zoom: Math.min(2.5, Math.max(1, zoomRaw)),
  };
}

export function inspirationCoverAspectClass(aspect: InspirationCoverAspect): string {
  if (aspect === "landscape") return "aspect-[4/3]";
  if (aspect === "square") return "aspect-square";
  return "aspect-[3/4]";
}

export function inspirationCoverStageRatio(aspect: InspirationCoverAspect): number {
  if (aspect === "landscape") return 4 / 3;
  if (aspect === "square") return 1;
  return 3 / 4;
}

export const INSPIRATION_COVER_ASPECT_OPTIONS: Array<{
  id: InspirationCoverAspect;
  label: string;
  hint: string;
}> = [
  { id: "portrait", label: "Portrait", hint: "3:4" },
  { id: "square", label: "Carré", hint: "1:1" },
  { id: "landscape", label: "Paysage", hint: "4:3" },
];
