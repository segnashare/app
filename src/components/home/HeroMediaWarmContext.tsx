"use client";

import { createContext, useContext, type ReactNode } from "react";

const HeroMediaWarmContext = createContext<Map<string, string>>(new Map());

export function HeroMediaWarmProvider({
  warmed,
  children,
}: {
  warmed: Map<string, string>;
  children: ReactNode;
}) {
  return <HeroMediaWarmContext.Provider value={warmed}>{children}</HeroMediaWarmContext.Provider>;
}

/** URL affichable (souvent blob local après préchargement) pour une URL Storage signée. */
export function useHeroMediaWarmUrl(sourceUrl: string | null | undefined): string | null {
  const warmed = useContext(HeroMediaWarmContext);
  if (!sourceUrl?.trim()) return null;
  const key = sourceUrl.trim();
  return warmed.get(key) ?? key;
}
