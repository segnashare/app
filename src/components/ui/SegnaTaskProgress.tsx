"use client";

import { cn } from "@/lib/utils/cn";

type SegnaTaskProgressProps = {
  total: number;
  /** Nombre de tâches terminées (0 → total). */
  filled: number;
  layout?: "ring" | "bar";
  /** `onDark` : anneau blanc sur fond noir (FAB). `onLight` : barre noire sur fond gris (modale). */
  variant?: "onLight" | "onDark";
  /** Diamètre du bouton rond (px) — aligné sur le pill panier par défaut. */
  ringSize?: number;
  className?: string;
};

function clampProgress(total: number, filled: number): { count: number; done: number; ratio: number } {
  const count = Math.max(1, Math.floor(total));
  const done = Math.min(Math.max(0, Math.floor(filled)), count);
  return { count, done, ratio: done / count };
}

/** Proportions maquette onboarding : anneau inset (~11,5 % marge), trait ~15,5 % du rayon. */
function onboardingRingMetrics(size: number): { stroke: number; pathRadius: number; circumference: number } {
  const half = size / 2;
  const edgeInset = half * 0.115;
  const stroke = half * 0.155;
  const pathRadius = half - edgeInset - stroke / 2;
  return { stroke, pathRadius, circumference: 2 * Math.PI * pathRadius };
}

/** Taille du compteur centré dans le bouton rond (~28 % du diamètre). */
export function segnaTaskRingCounterFontSizePx(ringSize: number): number {
  return Math.round(ringSize * 0.28);
}

/**
 * Progression onboarding Segna — arc / barre continus (noir, gris, blanc).
 */
export function SegnaTaskProgress({
  total,
  filled,
  layout = "ring",
  variant = "onLight",
  ringSize = 60,
  className,
}: SegnaTaskProgressProps) {
  const { ratio } = clampProgress(total, filled);

  if (layout === "bar") {
    const track = variant === "onDark" ? "bg-white/25" : "bg-zinc-200";
    const fill = variant === "onDark" ? "bg-white" : "bg-zinc-900";
    return (
      <div
        className={cn("h-2 min-w-0 flex-1 overflow-hidden rounded-full", track, className)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fill)} style={{ width: `${ratio * 100}%` }} />
      </div>
    );
  }

  const size = ringSize;
  const { stroke, pathRadius, circumference } = onboardingRingMetrics(size);
  const dashOffset = circumference * (1 - ratio);
  const trackStroke = variant === "onDark" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)";
  const progressStroke = variant === "onDark" ? "#ffffff" : "#18181b";
  const center = size / 2;

  return (
    <svg
      className={cn("pointer-events-none absolute inset-0 size-full -rotate-90", className)}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        cx={center}
        cy={center}
        r={pathRadius}
        fill="none"
        stroke={trackStroke}
        strokeWidth={stroke}
      />
      <circle
        cx={center}
        cy={center}
        r={pathRadius}
        fill="none"
        stroke={progressStroke}
        strokeWidth={stroke}
        strokeLinecap="butt"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}
