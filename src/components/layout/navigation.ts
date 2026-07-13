import type { LucideIcon } from "lucide-react";
import { Home, Repeat2, Search, UserRound } from "lucide-react";

export const MEMBER_HOME_HREF = "/home" as const;

export type MainTab = {
  id: "home" | "shop" | "exchange" | "profile";
  label: string;
  href: typeof MEMBER_HOME_HREF | "/shop" | "/exchange" | "/profile";
  icon: LucideIcon;
};

export const MAIN_TABS: MainTab[] = [
  { id: "home", label: "Segna", href: MEMBER_HOME_HREF, icon: Home },
  { id: "shop", label: "Catalogue", href: "/shop", icon: Search },
  { id: "exchange", label: "Exchange", href: "/exchange", icon: Repeat2 },
  { id: "profile", label: "Profile", href: "/profile", icon: UserRound },
];

const TASK_SEGMENTS = new Set(["edit", "create", "complete", "checkout", "completion", "transaction"]);

/** Flux `/items/*` sans fiche pièce (pas un id d’article). */
const ITEM_FLOW_SEGMENTS = new Set(["new", "shipping", "outtake-shipping", "proposal"]);

export function isMainTabRoute(pathname: string): boolean {
  return MAIN_TABS.some((tab) => {
    if (pathname === tab.href) return true;
    if (tab.href === "/shop" && pathname.startsWith("/shop/")) return true;
    return false;
  });
}

export function shouldShowTabBar(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return false;
  if (segments.some((segment) => TASK_SEGMENTS.has(segment.toLowerCase()))) return false;
  if (pathname === "/cart" || pathname.startsWith("/cart/")) return false;
  return isMainTabRoute(pathname) || isItemDetailRoute(pathname) || isLookDetailRoute(pathname);
}

/** Fiche look éditorial Segna : `/look/{id}`. */
export function isLookDetailRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "look" && segments.length === 2;
}

/** Fiche pièce membre / catalogue : `/items/{id}` (hors flux new, shipping, etc.). */
export function isItemDetailRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "items" || segments.length !== 2) return false;
  return !ITEM_FLOW_SEGMENTS.has(segments[1].toLowerCase());
}

/** Bouton flottant « Voir le panier » : onglets principaux uniquement (pas fiche pièce). */
export function shouldShowFloatingCartButton(pathname: string): boolean {
  if (isItemDetailRoute(pathname)) return false;
  return isMainTabRoute(pathname);
}

/** Pastille « aide / signalement » (MainShell, membre connecté). */
export function shouldShowMemberFeedbackFab(pathname: string): boolean {
  if (pathname === "/cart" || pathname.startsWith("/cart/")) return false;
  return true;
}

export function isHomeTabActive(pathname: string): boolean {
  return pathname === MEMBER_HOME_HREF;
}

export function isShopTabActive(pathname: string): boolean {
  return pathname === "/shop" || pathname.startsWith("/shop/") || isItemDetailRoute(pathname);
}
