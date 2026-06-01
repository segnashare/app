"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { SEGNA_DIALOG_SHEET_CLASS } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

/** Poignée visuelle des bottom sheets (évite le doublon avec une bordure haute). */
export function SegnaDialogSheetHandle({ className }: { className?: string }) {
  return <div className={cn("mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200", className)} aria-hidden />;
}

type SegnaAppBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Attributs ARIA sur la feuille. */
  dialogId?: string;
  labelledBy?: string;
  className?: string;
  overlayClassName?: string;
  zIndexClassName?: string;
};

/**
 * Bottom sheet portée sur `document.body` (hors `overflow-x-hidden` du shell mobile)
 * pour éviter les artefacts visuels après fermeture sur iOS / WebKit.
 */
export function SegnaAppBottomSheet({
  open,
  onClose,
  children,
  dialogId,
  labelledBy,
  className,
  overlayClassName,
  zIndexClassName = "z-[100]",
}: SegnaAppBottomSheetProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex flex-col justify-end bg-black/40",
        zIndexClassName,
        overlayClassName,
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(SEGNA_DIALOG_SHEET_CLASS, "relative w-full", className)}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
