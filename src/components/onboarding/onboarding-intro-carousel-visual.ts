export type OnboardingCarouselVisualState = {
  activeIndex: number;
  backgroundHex: string;
};

export function normalizeSlideBackgroundHex(raw: string | undefined | null, fallback: string): string {
  if (!raw || typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t}`;
  return fallback;
}

export function isLightBackgroundHex(hex: string): boolean {
  const n = hex.replace("#", "");
  if (n.length !== 6) return true;
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72;
}
