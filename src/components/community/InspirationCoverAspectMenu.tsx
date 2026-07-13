"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  INSPIRATION_COVER_ASPECT_OPTIONS,
  type InspirationCoverAspect,
} from "@/lib/community/inspiration-cover-aspect";
import { cn } from "@/lib/utils/cn";

function CoverAspectMenuIcon({ aspect }: { aspect: InspirationCoverAspect }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-[3px] border-2 border-current",
        aspect === "landscape" ? "h-2.5 w-4" : aspect === "square" ? "h-3.5 w-3.5" : "h-4 w-2.5",
      )}
      aria-hidden
    />
  );
}

function CoverAspectTriggerIcon() {
  return (
    <svg className="h-[22px] w-[22px] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type InspirationCoverAspectMenuProps = {
  value: InspirationCoverAspect;
  onChange: (aspect: InspirationCoverAspect) => void;
  className?: string;
};

export function InspirationCoverAspectMenu({ value, onChange, className }: InspirationCoverAspectMenuProps) {
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
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label="Format du cadre"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-800 transition",
          "hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20",
          open && "bg-zinc-100",
        )}
      >
        <CoverAspectTriggerIcon />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Format du cadre"
          className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[168px] overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.28)]"
        >
          {INSPIRATION_COVER_ASPECT_OPTIONS.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] font-medium text-zinc-900 transition hover:bg-zinc-50",
                  selected && "bg-zinc-50",
                )}
              >
                <CoverAspectMenuIcon aspect={option.id} />
                <span className="min-w-0 flex-1">{option.label}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-zinc-900" strokeWidth={2.5} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
