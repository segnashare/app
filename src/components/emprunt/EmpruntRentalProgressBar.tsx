"use client";

import { computeRentalProgress, type RentalProgressTone } from "@/lib/emprunt/rental-progress";
import { cn } from "@/lib/utils/cn";

type Props = {
  startMs: number;
  dueMs: number;
  nowMs?: number;
  /** Jours de prolongation inclus dans `dueMs` (marqueur d’échéance initiale). */
  extensionDays?: number;
  className?: string;
};

const TONE_HEX: Record<RentalProgressTone, string> = {
  blue: "#208AEF",
  orange: "#F59E0B",
  red: "#E44D3E",
};

function lucioleRadial(hex: string): string {
  const rgb =
    hex === "#208AEF"
      ? "32, 138, 239"
      : hex === "#F59E0B"
        ? "245, 158, 11"
        : "228, 77, 62";
  return `radial-gradient(
  circle,
  ${hex} 0%,
  ${hex} 14%,
  rgba(${rgb}, 0.55) 28%,
  rgba(${rgb}, 0.22) 48%,
  rgba(${rgb}, 0.06) 68%,
  transparent 78%
)`;
}

function DeadlineDot({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="pointer-events-none absolute top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${pct}%` }}
      title={label}
      aria-hidden
    >
      <span className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-zinc-900 shadow-[0_0_0_1px_rgba(24,24,27,0.25)]" />
    </div>
  );
}

/** Barre de progression location (bleu → orange J-2/J-1 → rouge jour J / retard). */
export function EmpruntRentalProgressBar({
  startMs,
  dueMs,
  nowMs,
  extensionDays = 0,
  className,
}: Props) {
  const progress = computeRentalProgress({ startMs, dueMs, nowMs, extensionDays });
  if (!progress) return null;

  const fillPct = Math.round(progress.ratio * 1000) / 10;
  /** Léger inset pour que la luciole reste visible dès le jour 1. */
  const tipPct = Math.min(100, Math.max(fillPct, 0.8));
  const color = TONE_HEX[progress.tone];

  const initialPct =
    progress.initialDueMarkerRatio != null
      ? Math.round(progress.initialDueMarkerRatio * 1000) / 10
      : null;
  const extendedPct =
    progress.extendedDueMarkerRatio != null
      ? Math.round(progress.extendedDueMarkerRatio * 1000) / 10
      : null;
  const showInitial =
    initialPct != null && (extendedPct == null || Math.abs(initialPct - extendedPct) > 0.8);
  const showExtended = extendedPct != null;

  return (
    <div className={cn("mt-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="relative h-[5px] min-w-0 flex-1 overflow-visible">
          <div className="absolute inset-0 rounded-full bg-zinc-200" />
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width,background-color] duration-500 ease-out"
            style={{
              width: `${fillPct}%`,
              backgroundColor: color,
            }}
          />
          {showInitial && initialPct != null ? (
            <DeadlineDot pct={initialPct} label="Échéance initiale" />
          ) : null}
          {showExtended && extendedPct != null ? (
            <DeadlineDot
              pct={extendedPct}
              label={
                progress.extensionDays > 0
                  ? "Échéance avec prolongation"
                  : "Échéance"
              }
            />
          ) : null}
          <div
            className="pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${tipPct}%` }}
            aria-hidden
          >
            <span
              className="block h-7 w-7 animate-pulse"
              style={{ background: lucioleRadial(color) }}
            />
          </div>
        </div>
        <span className="shrink-0 text-[12px] font-medium tabular-nums text-zinc-600">
          {progress.label}
        </span>
      </div>
    </div>
  );
}
