"use client";

import { useEffect, useRef, useState } from "react";
import { Tag } from "lucide-react";

import { CartCatalogModeToggle } from "@/components/cart/CartCatalogModeToggle";
import { useCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import { cartCatalogModeLabel } from "@/lib/cart/cart-catalog-mode";
import { cn } from "@/lib/utils/cn";

export function ShopCartCatalogModeButton() {
  const { mode } = useCartCatalogMode();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Mode d'affichage : ${cartCatalogModeLabel(mode)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-800 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.08)] transition-colors duration-200",
          "hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35",
          open && "border-zinc-900 bg-zinc-900 text-white",
        )}
      >
        <Tag className="h-5 w-5" strokeWidth={2.1} aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Affichage des prix"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(16.5rem,calc(100vw-2rem))]"
        >
          <CartCatalogModeToggle className="shadow-[0_12px_40px_-12px_rgba(0,0,0,0.28)]" />
        </div>
      ) : null}
    </div>
  );
}
