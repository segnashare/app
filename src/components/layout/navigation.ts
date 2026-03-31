import type { LucideIcon } from "lucide-react";
import { House, Store, Repeat2, Users, UserRound } from "lucide-react";

export type MainTab = {
  id: "home" | "shop" | "exchange" | "community" | "profile";
  label: string;
  href: "/home" | "/shop" | "/exchange" | "/community" | "/profile";
  icon: LucideIcon;
};

export const MAIN_TABS: MainTab[] = [
  { id: "home", label: "Home", href: "/home", icon: House },
  { id: "shop", label: "Shop", href: "/shop", icon: Store },
  { id: "exchange", label: "Exchange", href: "/exchange", icon: Repeat2 },
  { id: "community", label: "Community", href: "/community", icon: Users },
  { id: "profile", label: "Profile", href: "/profile", icon: UserRound },
];

const TASK_SEGMENTS = new Set(["edit", "create", "complete", "checkout", "completion", "transaction"]);

export function isMainTabRoute(pathname: string): boolean {
  return MAIN_TABS.some((tab) => pathname === tab.href);
}

export function shouldShowTabBar(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return false;
  if (segments.some((segment) => TASK_SEGMENTS.has(segment.toLowerCase()))) return false;
  if (pathname === "/cart" || pathname.startsWith("/cart/")) return false;
  return isMainTabRoute(pathname);
}

/** Bouton flottant « Voir le panier » : feed + catalogue uniquement. */
export function shouldShowFloatingCartButton(pathname: string): boolean {
  return pathname === "/home" || pathname === "/shop";
}

export function isShopTabActive(pathname: string): boolean {
  return pathname === "/shop";
}
