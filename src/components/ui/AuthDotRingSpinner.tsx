"use client";

import { cn } from "@/lib/utils/cn";

const DOT_COUNT = 8;
const STEP_DEG = 360 / DOT_COUNT;

type AuthDotRingSpinnerProps = {
  className?: string;
  /** `onLight`: fond clair (point actif noir). `onDark`: fond sombre (point actif blanc). */
  variant?: "onLight" | "onDark";
  "aria-label"?: string;
};

const DOT = 4;
const R = 7;

/**
 * Anneau de 8 points (style charge iOS) : un point noir en tête, les autres gris clair, rotation continue.
 */
export function AuthDotRingSpinner({
  className,
  variant = "onLight",
  "aria-label": ariaLabel = "Chargement",
}: AuthDotRingSpinnerProps) {
  const active = variant === "onDark" ? "bg-white" : "bg-black";
  const inactive = variant === "onDark" ? "bg-white/40" : "bg-[#c8c8c8]";

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn("relative inline-flex size-6 shrink-0 items-center justify-center", className)}
    >
      <span
        className="absolute inset-0 animate-spin"
        style={{ animationDuration: "1s", animationTimingFunction: "linear" }}
      >
        {Array.from({ length: DOT_COUNT }, (_, i) => (
          <span
            key={i}
            className={cn("absolute rounded-full", i === 0 ? active : inactive)}
            style={{
              width: DOT,
              height: DOT,
              left: "50%",
              top: "50%",
              marginLeft: -DOT / 2,
              marginTop: -DOT / 2,
              transform: `rotate(${i * STEP_DEG}deg) translateY(-${R}px)`,
            }}
          />
        ))}
      </span>
    </span>
  );
}
