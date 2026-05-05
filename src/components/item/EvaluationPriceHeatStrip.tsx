"use client";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

type Marker = {
  key: string;
  value: number;
  label: string;
  emphasis?: boolean;
};

type Props = {
  low?: number | null;
  median?: number | null;
  high?: number | null;
  segnaOffer?: number | null;
  proposedPoints?: number | null;
  className?: string;
  /** Masque le sous-titre « Lecture marché » quand le composant est intégré sous « Analyse IA ». */
  embedded?: boolean;
};

function shortLabel(group: Marker[]): string {
  const keys = new Set(group.map((g) => g.key));
  const parts: string[] = [];
  if (keys.has("low")) parts.push("Basse");
  if (keys.has("median")) parts.push("Médiane");
  if (keys.has("high")) parts.push("Haute");
  if (keys.has("segna")) parts.push("Segna");
  if (keys.has("proposal") || keys.has("proposal-only")) parts.push("Proposition");
  return parts.length ? parts.join(" · ") : group.map((g) => g.label).join(" · ");
}

const TRACK_GRADIENT =
  "linear-gradient(90deg, rgb(228 228 231) 0%, rgb(212 212 216) 40%, rgb(161 161 170) 100%)";

const TRACK_H = 10;

/**
 * Fourchette de points : rail zinc discret, pastilles et lien fin alignés sur la même verticale.
 */
export function EvaluationPriceHeatStrip({
  low,
  median,
  high,
  segnaOffer,
  proposedPoints,
  className,
  embedded = false,
}: Props) {
  const L = low != null && Number.isFinite(low) ? Math.round(low) : null;
  const M = median != null && Number.isFinite(median) ? Math.round(median) : null;
  const H = high != null && Number.isFinite(high) ? Math.round(high) : null;
  const S = segnaOffer != null && Number.isFinite(segnaOffer) ? Math.round(segnaOffer) : null;
  const P =
    proposedPoints != null && Number.isFinite(proposedPoints) ? Math.round(proposedPoints) : null;

  const numeric = [L, M, H, S, P].filter((n): n is number => n != null);
  if (numeric.length === 0) return null;

  let minV = Math.min(...numeric);
  let maxV = Math.max(...numeric);
  if (minV === maxV) {
    minV -= Math.max(1, Math.round(minV * 0.08));
    maxV += Math.max(1, Math.round(maxV * 0.08));
  }
  const span = maxV - minV;
  const pct = (v: number) => clamp01((v - minV) / span) * 100;

  const markers: Marker[] = [];
  if (L != null) markers.push({ key: "low", value: L, label: "Fourchette basse" });
  if (M != null) markers.push({ key: "median", value: M, label: "Médiane" });
  if (H != null) markers.push({ key: "high", value: H, label: "Fourchette haute" });

  const propDistinct = P != null && S != null && P !== S;
  if (S != null) {
    markers.push({
      key: "segna",
      value: S,
      label: propDistinct ? "Estimation IA" : "Valorisation Segna",
      emphasis: true,
    });
  }
  if (propDistinct && P != null) {
    markers.push({ key: "proposal", value: P, label: "Proposition affichée", emphasis: true });
  }
  if (S == null && P != null) {
    markers.push({ key: "proposal-only", value: P, label: "Proposition Segna", emphasis: true });
  }

  const dedup = new Map<number, Marker[]>();
  for (const m of markers) {
    const list = dedup.get(m.value) ?? [];
    list.push(m);
    dedup.set(m.value, list);
  }

  const sortedEntries = [...dedup.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className={cn(montserrat.className, className)}>
      {!embedded ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Lecture marché (pts)
        </p>
      ) : null}

      <div
        className={cn(
          "relative mx-auto w-full min-h-[5.5rem] pb-[10px]",
          embedded ? "mt-1" : "mt-4",
        )}
      >
        {/* Libellé + trait : ancrés au sommet du rail (bottom = TRACK_H) */}
        {sortedEntries.map(([value, group]) => {
          const leftPct = pct(value);
          const emphasis = group.some((g) => g.emphasis);
          const label = shortLabel(group);

          return (
            <div
              key={`col-${value}-${label}`}
              className="pointer-events-none absolute bottom-[10px] z-10 flex w-0 flex-col items-center gap-1.5"
              style={{
                left: `${leftPct}%`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="flex w-[min(5.75rem,30vw)] flex-col items-center gap-0.5 text-center">
                <span className="text-[9px] font-medium uppercase leading-tight tracking-[0.08em] text-zinc-500">
                  {label}
                </span>
                <span
                  className={cn(
                    "text-[15px] font-semibold tabular-nums leading-none tracking-tight text-zinc-800",
                    emphasis && "text-zinc-950",
                  )}
                >
                  {value}
                  <span className="text-[11px] font-medium text-zinc-500"> pts</span>
                </span>
              </div>
              <span
                className={cn(
                  "block w-px shrink-0 rounded-full bg-zinc-300/95",
                  emphasis ? "h-[13px]" : "h-[10px]",
                )}
                aria-hidden
              />
            </div>
          );
        })}

        {/* Rail pleine largeur, pastilles centrées sur le même % */}
        <div
          className="absolute bottom-0 left-0 right-0 z-0 overflow-visible rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
          style={{ height: TRACK_H }}
          aria-hidden
        >
          <div className="absolute inset-0 rounded-full" style={{ background: TRACK_GRADIENT }} />
          {sortedEntries.map(([value, group]) => {
            const leftPct = pct(value);
            const emphasis = group.some((g) => g.emphasis);
            const label = shortLabel(group);
            return (
              <div
                key={`dot-${value}-${label}`}
                className="pointer-events-none absolute top-1/2 left-0 z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${leftPct}%` }}
                aria-hidden
              >
                <span
                  className={cn(
                    "block rounded-full bg-white shadow-sm ring-1 ring-zinc-400/70",
                    emphasis ? "h-3 w-3 ring-2 ring-zinc-800/85" : "h-2 w-2 ring-zinc-400/85",
                  )}
                  style={
                    emphasis ? { background: "rgb(39 39 42)" } : { background: "rgb(255 255 255)" }
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] tabular-nums text-zinc-400">
        {minV} pts — {maxV} pts
      </p>
    </div>
  );
}
