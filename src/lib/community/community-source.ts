import type { InspirationSource, InspirationUrlSource } from "@/lib/community/types";
import { styleLookHref } from "@/lib/looks/style-look-href";

export function urlSourceToDbSource(urlSource: string): InspirationSource | null {
  if (urlSource === "segna") return "segna_style";
  if (urlSource === "member") return "member";
  return null;
}

export function dbSourceToUrlSource(source: InspirationSource): InspirationUrlSource {
  return source === "segna_style" ? "segna" : "member";
}

export function inspirationHref(_source: InspirationSource, id: string): string {
  return styleLookHref(id);
}
