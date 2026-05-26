"use client";

import type { ReactNode } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

/** Espace sous le header fixe (pt-7 + titre + pb-4). */
export const NEW_ITEM_DETAIL_HEADER_OFFSET_CLASS = "pt-[72px]";

export type NewItemDetailPageShellProps = {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children: ReactNode;
  /** Classes sur la zone scroll (sous le header fixe). */
  scrollClassName?: string;
  /** Largeur max du bloc contenu (défaut 380px). */
  contentClassName?: string;
};

export function NewItemDetailPageShell({
  title,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  children,
  scrollClassName,
  contentClassName = "mx-auto w-full max-w-[380px]",
}: NewItemDetailPageShellProps) {
  return (
    <main className="flex min-h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="fixed inset-x-0 top-0 z-50 flex justify-center border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-[460px] items-center justify-between px-5 pb-4 pt-7">
          <button
            type="button"
            className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900")}
            onClick={onCancel}
          >
            Annuler
          </button>
          <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>
            {title}
          </h1>
          <button
            type="button"
            className={cn(montserrat.className, "text-[18px] font-semibold text-zinc-900 disabled:opacity-40")}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            Terminé
          </button>
        </div>
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto", NEW_ITEM_DETAIL_HEADER_OFFSET_CLASS, scrollClassName)}>
        <div className={cn("mx-auto w-full max-w-[460px] px-4 pb-8", scrollClassName)}>
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </main>
  );
}
