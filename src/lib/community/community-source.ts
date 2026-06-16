import type { InspirationSource, InspirationUrlSource } from "@/lib/community/types";

export function urlSourceToDbSource(urlSource: string): InspirationSource | null {
  if (urlSource === "segna") return "segna_style";
  if (urlSource === "member") return "member";
  return null;
}

export function dbSourceToUrlSource(source: InspirationSource): InspirationUrlSource {
  return source === "segna_style" ? "segna" : "member";
}

export function inspirationHref(source: InspirationSource, id: string): string {
  return `/community/inspi/${dbSourceToUrlSource(source)}/${id}`;
}
