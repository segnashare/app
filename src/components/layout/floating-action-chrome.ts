import { cn } from "@/lib/utils/cn";

/** Hauteur du pill « Voir le panier » — sert aussi de diamètre des boutons ronds (onboarding, message). */
export const FLOATING_CART_PILL_MIN_HEIGHT_PX = 60;

export const FLOATING_ROUND_ACTION_SIZE_CLASS = "size-[60px]";

export const FLOATING_ROUND_ACTION_SHELL_CLASS = cn(
  "pointer-events-auto relative flex size-[60px] shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white",
  "shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition hover:bg-zinc-800 active:scale-[0.97]",
);

/** Aligné sur le pill panier pour une même ligne de base. */
export const FLOATING_BOTTOM_ABOVE_TAB_BAR = "calc(56px + env(safe-area-inset-bottom, 0px) + 10px)";
export const FLOATING_BOTTOM_WITHOUT_TAB_BAR = "calc(10px + env(safe-area-inset-bottom, 0px))";
