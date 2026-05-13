"use client";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

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

const BAR_W_CLASS = "w-full max-w-[min(100%,22rem)]";
/** Hauteur du rail (rainure). */
const TRACK_H = 14;

/**
 * Fourchette marché : rail en noir & blanc (dégradé zinc sur Q1–Q3), pastilles Q1/Q3, médiane, prix Segna.
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

  const hasQ = L != null && H != null;
  const numeric = [L, M, H, S, P].filter((n): n is number => n != null);
  if (numeric.length === 0) return null;

  const q1Raw = L != null && H != null ? Math.min(L, H) : L;
  const q3Raw = L != null && H != null ? Math.max(L, H) : H;

  let axisMin: number;
  let axisMax: number;
  let q1: number | null = q1Raw;
  let q3: number | null = q3Raw;

  if (hasQ) {
    const iqr = Math.max(q3Raw! - q1Raw!, 1);
    const pad = Math.max(Math.round(iqr * 0.22), 1);
    axisMin = q1Raw! - pad;
    axisMax = q3Raw! + pad;
  } else if (L != null && H == null) {
    const span = Math.max(Math.round(Math.abs(L) * 0.12), 8);
    axisMin = L - span;
    axisMax = L + span;
    q3 = null;
  } else if (H != null && L == null) {
    const span = Math.max(Math.round(Math.abs(H) * 0.12), 8);
    axisMin = H - span;
    axisMax = H + span;
    q1 = null;
  } else {
    const center = M ?? S ?? P ?? 0;
    const span = Math.max(Math.round(Math.abs(center) * 0.15), 20);
    axisMin = center - span;
    axisMax = center + span;
    q1 = null;
    q3 = null;
  }

  for (const v of numeric) {
    if (v < axisMin) axisMin = v - Math.max(1, Math.round((axisMax - axisMin) * 0.04));
    if (v > axisMax) axisMax = v + Math.max(1, Math.round((axisMax - axisMin) * 0.04));
  }

  if (axisMin >= axisMax) {
    axisMin -= 1;
    axisMax += 1;
  }

  const span = axisMax - axisMin;
  const pct = (v: number) => clamp01((v - axisMin) / span) * 100;

  const iqrLeftPct = hasQ && q1 != null ? pct(q1) : 0;
  const iqrRightPct = hasQ && q3 != null ? pct(q3) : 100;
  const iqrWidthPct = Math.max(iqrRightPct - iqrLeftPct, 1.2);
  /** Pastilles Q1/Q3 trop proches : léger décalage vertical pour éviter le chevauchement. */
  const qPillsTight = iqrWidthPct < 18;

  const showMedian = M != null;
  const medianPct = showMedian ? pct(M!) : null;

  const showSegna = S != null;
  const segnaPct = showSegna ? pct(S!) : null;

  const propDistinct = P != null && S != null && P !== S;
  const showProposal = propDistinct && P != null;
  const proposalPct = showProposal ? pct(P!) : null;

  const medianNearQ1 =
    showMedian && medianPct != null && hasQ ? Math.abs(medianPct - iqrLeftPct) < 11 : false;
  const medianNearQ3 =
    showMedian && medianPct != null && hasQ ? Math.abs(medianPct - iqrRightPct) < 11 : false;

  return (
    <div className={cn(montserrat.className, className)}>
      {!embedded ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Lecture marché (pts)
        </p>
      ) : null}

      <div
        className={cn(
          "relative mx-auto",
          BAR_W_CLASS,
          embedded ? "mt-3 min-h-0 pt-10 sm:pt-11" : "mt-4",
        )}
      >
        {/* Espace pour pastilles Q1 / Q3 (ancrées en bas de cette ligne) */}
        <div className="relative mb-1 min-h-[2.125rem] w-full">
          {hasQ && q1Raw != null && q3Raw != null ? (
            <>
              <div
                className={cn(
                  "pointer-events-none absolute bottom-0 z-20 flex -translate-x-1/2 flex-col items-center",
                  qPillsTight ? "-translate-y-0.5" : "",
                )}
                style={{ left: `${iqrLeftPct}%` }}
              >
                <span
                  className={cn(
                    "rounded-full bg-gradient-to-r from-zinc-900 to-zinc-800 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white shadow-[0_3px_10px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.12)]",
                  )}
                >
                  {q1Raw}
                </span>
                <span
                  className="mt-0.5 block h-2 w-px bg-gradient-to-b from-zinc-600/90 to-transparent"
                  aria-hidden
                />
              </div>
              <div
                className={cn(
                  "pointer-events-none absolute bottom-0 z-20 flex -translate-x-1/2 flex-col items-center",
                  qPillsTight ? "translate-y-0.5" : "",
                )}
                style={{ left: `${iqrRightPct}%` }}
              >
                <span
                  className={cn(
                    "rounded-full border border-zinc-300 bg-gradient-to-r from-white to-zinc-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-zinc-900 shadow-[0_2px_8px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,1)]",
                  )}
                >
                  {q3Raw}
                </span>
                <span
                  className="mt-0.5 block h-2 w-px bg-gradient-to-b from-zinc-500/80 to-transparent"
                  aria-hidden
                />
              </div>
            </>
          ) : null}
        </div>

        <div
          className={cn(
            "relative mb-12 w-full",
            showMedian ? "pt-2 sm:pt-3" : "pt-0",
          )}
          role="img"
          aria-label={
            [
              hasQ
                ? `Fourchette marché de ${Math.round(axisMin)} à ${Math.round(axisMax)} points, zone interquartile entre ${q1Raw} et ${q3Raw} points`
                : `Échelle de ${Math.round(axisMin)} à ${Math.round(axisMax)} points`,
              showMedian ? `Médiane ${M} points` : null,
              showSegna ? `Prix Segna ${S} points` : null,
            ]
              .filter(Boolean)
              .join(". ")
          }
        >
          {showMedian && medianPct != null ? (
            <div
              className={cn(
                "group absolute z-30 flex -translate-x-1/2 flex-col items-center pointer-events-auto",
                medianNearQ1 && "-translate-y-1",
                medianNearQ3 && "-translate-y-1",
              )}
              style={{ left: `${medianPct}%`, bottom: "100%", marginBottom: "7px" }}
              aria-label={`Médiane, ${M} points`}
            >
              <div
                className={cn(
                  "relative rounded-xl border border-zinc-200/95 px-2 py-0.5 text-center",
                  "bg-gradient-to-br from-white via-zinc-50/80 to-white",
                  "shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06),0_0_18px_-4px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)]",
                )}
              >
                <span
                  className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800/95 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
                  aria-hidden
                >
                  Médiane
                </span>
                <span className="text-[12px] font-bold tabular-nums leading-none tracking-tight text-zinc-900">
                  {M}
                </span>
              </div>
              <span
                className="mt-0.5 block h-2 w-px shrink-0 rounded-full bg-gradient-to-b from-zinc-700/90 via-zinc-500/70 to-zinc-300/25 shadow-[0_0_3px_rgba(0,0,0,0.2)]"
                aria-hidden
              />
            </div>
          ) : null}

          {/* Rainure (type slider inset) */}
          <div
            className="relative w-full overflow-hidden rounded-full bg-zinc-300/90 shadow-[inset_0_2px_6px_rgba(0,0,0,0.14),inset_0_-1px_0_rgba(255,255,255,0.45)]"
            style={{ height: TRACK_H }}
          >
            <div
              className="pointer-events-none absolute inset-[2px] rounded-full bg-zinc-100/95 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"
              aria-hidden
            />

            {hasQ && q1 != null && q3 != null ? (
              <>
                <div
                  className="pointer-events-none absolute inset-y-[2px] z-[1] rounded-full bg-gradient-to-r from-zinc-800 via-zinc-500 to-zinc-300 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                  style={{
                    left: `${iqrLeftPct}%`,
                    width: `${iqrWidthPct}%`,
                  }}
                  aria-hidden
                />
                {/* Repères discrets aux bornes Q1 / Q3 (traits, pas ronds) */}
                <div
                  className="pointer-events-none absolute top-1/2 z-[2] h-[9px] w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
                  style={{ left: `${iqrLeftPct}%` }}
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute top-1/2 z-[2] h-[9px] w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
                  style={{ left: `${iqrRightPct}%` }}
                  aria-hidden
                />
              </>
            ) : null}

            {showMedian && medianPct != null ? (
              <div
                className="pointer-events-none absolute top-1/2 z-[3] h-[11px] w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                style={{ left: `${medianPct}%` }}
                title={`Médiane : ${M}`}
                aria-hidden
              />
            ) : null}

            {showProposal && proposalPct != null ? (
              <div
                className="pointer-events-none absolute top-1/2 z-[4] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-zinc-600 bg-white shadow-sm"
                style={{ left: `${proposalPct}%` }}
                title={`Proposition : ${P} pts`}
                aria-hidden
              />
            ) : null}

            {showSegna && segnaPct != null ? (
              <div
                className="pointer-events-none absolute top-1/2 z-[5] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-900 bg-zinc-900 shadow-[0_1px_4px_rgba(0,0,0,0.25),0_0_0_2px_rgba(255,255,255,0.95)]"
                style={{ left: `${segnaPct}%` }}
                title={`Prix Segna : ${S} pts`}
                aria-hidden
              />
            ) : null}
          </div>

          {showSegna && segnaPct != null ? (
            <div
              className="pointer-events-none absolute z-30 mt-1.5 flex -translate-x-1/2 flex-col items-center text-center"
              style={{ left: `${segnaPct}%`, top: "100%" }}
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Prix Segna
              </span>
              <span className="mt-0.5 text-[13px] font-semibold tabular-nums leading-none tracking-tight text-zinc-900">
                {S} <span className="text-[11px] font-medium text-zinc-500">pts</span>
              </span>
              {showProposal && P != null ? (
                <span className="mt-1 text-[10px] font-medium tabular-nums text-zinc-500">
                  Proposition {P} pts
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
