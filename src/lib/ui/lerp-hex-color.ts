/** Interpolation linéaire entre deux couleurs `#rrggbb` (pour fonds liés au scroll). */
export function lerpHexColors(fromHex: string, toHex: string, t: number): string {
  const a = parseRgb(fromHex);
  const b = parseRgb(toHex);
  if (!a || !b) return toHex;
  const u = Math.min(1, Math.max(0, t));
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.replace("#", "").trim();
  if (t.length !== 6) return null;
  const r = Number.parseInt(t.slice(0, 2), 16);
  const g = Number.parseInt(t.slice(2, 4), 16);
  const b = Number.parseInt(t.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return { r, g, b };
}
