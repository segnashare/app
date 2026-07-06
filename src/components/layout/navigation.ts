import type { LucideIcon } from "lucide-react";
import { Store, Repeat2, Users, UserRound } from "lucide-react";

export type MainTab = {
  id: "shop" | "exchange" | "community" | "profile";
  label: string;
  href: "/shop" | "/exchange" | "/community" | "/profile";
  icon: LucideIcon;
};

export const MAIN_TABS: MainTab[] = [
  { id: "shop", label: "Shop", href: "/shop", icon: Store },
  { id: "exchange", label: "Exchange", href: "/exchange", icon: Repeat2 },
  { id: "community", label: "Community", href: "/community", icon: Users },
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
  return isMainTabRoute(pathname) || isItemDetailRoute(pathname);
}

/** Fiche pièce membre / catalogue : `/items/{id}` (hors flux new, shipping, etc.). */
export function isItemDetailRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "items" || segments.length !== 2) return false;
  return !ITEM_FLOW_SEGMENTS.has(segments[1].toLowerCase());
}

/** Bouton flottant « Voir le panier » : onglets principaux + fiches pièce. */
export function shouldShowFloatingCartButton(pathname: string): boolean {
  return isMainTabRoute(pathname) || isItemDetailRoute(pathname);
}

/** Pastille « aide / signalement » (MainShell, membre connecté). */
export function shouldShowMemberFeedbackFab(pathname: string): boolean {
  if (pathname === "/cart" || pathname.startsWith("/cart/")) return false;
  return true;
}

export function isShopTabActive(pathname: string): boolean {
  return pathname === "/shop" || pathname.startsWith("/shop/") || isItemDetailRoute(pathname);
}
