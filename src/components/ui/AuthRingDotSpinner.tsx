"use client";

import { cn } from "@/lib/utils/cn";

type AuthRingDotSpinnerProps = {
  className?: string;
  /** `onLight`: fond clair (point actif noir). `onDark`: fond bouton noir (point actif blanc). */
  variant?: "onLight" | "onDark";
  /** Nombre de points sur l’anneau (défaut : 6). */
  dotCount?: 6 | 8;
  /**
   * Nombre de points consécutifs (à partir du haut) en couleur « actif » (noir / blanc).
   * Ex. `2` = progression visuelle type étape 2 sur l’anneau.
   */
  filledDots?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * `false` = anneau fixe, masqué aux lecteurs d’écran (décoratif).
   * `true` = rotation + statut vivant pour un chargement réel.
   */
  spinning?: boolean;
  "aria-label"?: string;
};

const DOT = 9;
const R = 14;

/**
 * Anneau de points (6 par défaut, ou 8) : `filledDots` points actifs depuis le haut, rotation optionnelle — style loaders type iOS / auth minimaliste.
 */
export function AuthRingDotSpinner({
  className,
  variant = "onLight",
  dotCount = 6,
  filledDots = 1,
  spinning = true,
  "aria-label": ariaLabel = "Chargement",
}: AuthRingDotSpinnerProps) {
  const active = variant === "onDark" ? "bg-white" : "bg-black";
  const inactive = variant === "onDark" ? "bg-white/40" : "bg-[#d4d4d4]";
  const step = 360 / dotCount;
  const filled = Math.min(Math.max(filledDots, 1), dotCount);

  return (
    <span
      className={cn("relative inline-flex size-[24px] shrink-0 items-center justify-center", className)}
      role={spinning ? "status" : "presentation"}
      aria-hidden={spinning ? undefined : true}
      aria-live={spinning ? "polite" : undefined}
      aria-label={spinning ? ariaLabel : undefined}
    >
      <span
        className={cn("absolute inset-0", spinning && "animate-spin")}
        style={
          spinning
            ? { animationDuration: "0.9s", animationTimingFunction: "linear" }
            : undefined
        }
      >
        {Array.from({ length: dotCount }, (_, i) => (
          <span
            key={i}
            className={cn(
              "absolute rounded-full",
              spinning ? active : i < filled ? active : inactive,
            )}
            style={{
              width: DOT,
              height: DOT,
              left: "50%",
              top: "50%",
              marginLeft: -DOT / 2,
              marginTop: -DOT / 2,
              // Trail opacity while spinning — uniform black ring looks frozen.
              opacity: spinning ? Math.max(0.22, 1 - i / dotCount) : undefined,
              transform: `rotate(${i * step}deg) translateY(-${R}px)`,
            }}
          />
        ))}
      </span>
    </span>
  );
}
