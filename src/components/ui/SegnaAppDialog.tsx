import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

/**
 * Harmonisation des popups / feuilles : titre Playfair (type fiche commande),
 * corps Montserrat gris, pas de surtitre uppercase, pas de cadre interne décoratif.
 */
export const segnaDialogPlayfair = segnaPlayfairDisplay;
export const segnaDialogMontserrat = segnaMontserrat;

export function segnaDialogTitleClass(className?: string) {
  return cn(
    segnaPlayfairDisplay.className,
    "text-left text-[22px] font-bold leading-snug text-zinc-900 sm:text-[24px]",
    className,
  );
}

export function segnaDialogBodyClass(className?: string) {
  return cn(
    segnaMontserrat.className,
    "text-[14px] leading-relaxed text-zinc-600 sm:text-[15px]",
    className,
  );
}

/** Modale centrée (plein écran + carte). */
export const SEGNA_DIALOG_CARD_CLASS =
  "w-full max-w-[400px] rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl";

/** Feuille du bas (poignée `SegnaDialogSheetHandle` — pas de border-top pour éviter un double trait). */
export const SEGNA_DIALOG_SHEET_CLASS =
  "max-h-[85dvh] overflow-y-auto rounded-t-2xl border-x border-zinc-200 bg-white px-5 pb-8 pt-3 shadow-xl";

export function SegnaDialogTitleRow({
  id,
  title,
  right,
  className,
}: {
  id?: string;
  title: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-row items-start justify-between gap-3", className)}>
      <h2 id={id} className={cn(segnaDialogTitleClass(), "min-w-0 flex-1")}>
        {title}
      </h2>
      {right ? <div className="shrink-0 pt-0.5">{right}</div> : null}
    </div>
  );
}

/** Croix : `variant="overlay"` sur une carte `relative` ; `inline` dans la ligne de titre (`SegnaDialogTitleRow` / `right`). */
export function SegnaDialogDismissButton({
  onClick,
  variant = "overlay",
  className,
  "aria-label": ariaLabel = "Fermer",
}: {
  onClick: () => void;
  variant?: "overlay" | "inline";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-zinc-800 transition hover:bg-zinc-200/70",
        variant === "overlay" && "absolute right-2 top-2 z-[1] h-10 w-10",
        variant === "inline" && "h-9 w-9 shrink-0 text-zinc-700",
        className,
      )}
      aria-label={ariaLabel}
    >
      <X className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}
