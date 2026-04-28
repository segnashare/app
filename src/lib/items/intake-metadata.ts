/** Clés optionnelles renseignées côté back office dans `item_intake.metadata`. */
export const INTAKE_META_REFUSAL_MESSAGE = "refusal_member_message";
export const INTAKE_META_COMPLEMENT_MESSAGE = "complement_member_message";
/** ISO / timestamptz texte Postgres, posé au passage en `listing_stage = evaluation`. */
export const INTAKE_META_EVALUATION_STARTED_AT = "evaluation_started_at";
/** Synthèse IA alimentée par n8n pour affichage sur la page evaluation. */
export const INTAKE_META_AI_EVALUATION_SUMMARY = "ai_evaluation_summary";

export type IntakeAiEvaluationSummary = {
  suggested_range?: {
    low?: number;
    median?: number;
    high?: number;
  };
  segna_offer?: number;
  positioning?: string;
  rationale?: string;
};

export function readIntakeMetaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function readIntakeAiEvaluationSummary(metadata: unknown): IntakeAiEvaluationSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)[INTAKE_META_AI_EVALUATION_SUMMARY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const suggested = value.suggested_range;
  const suggestedObj = suggested && typeof suggested === "object" ? (suggested as Record<string, unknown>) : null;

  const low = asFiniteNumber(suggestedObj?.low);
  const median = asFiniteNumber(suggestedObj?.median);
  const high = asFiniteNumber(suggestedObj?.high);
  const segnaOffer = asFiniteNumber(value.segna_offer);
  const positioning = typeof value.positioning === "string" && value.positioning.trim() ? value.positioning.trim() : undefined;
  const rationale = typeof value.rationale === "string" && value.rationale.trim() ? value.rationale.trim() : undefined;

  const hasSuggested = low != null || median != null || high != null;
  const hasAny = hasSuggested || segnaOffer != null || positioning != null || rationale != null;
  if (!hasAny) return null;

  return {
    suggested_range: hasSuggested
      ? {
          ...(low != null ? { low } : {}),
          ...(median != null ? { median } : {}),
          ...(high != null ? { high } : {}),
        }
      : undefined,
    ...(segnaOffer != null ? { segna_offer: segnaOffer } : {}),
    ...(positioning ? { positioning } : {}),
    ...(rationale ? { rationale } : {}),
  };
}

/** Commentaire saisi côté BO lors du refus logistique (`metadata.verification`). */
export function readLogisticsRefusalNote(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const verification = (metadata as Record<string, unknown>).verification;
  if (!verification || typeof verification !== "object") return null;
  const v = verification as Record<string, unknown>;
  const refusal = v.refusal_comment;
  const last = v.last_logistics_decision_note;
  if (typeof refusal === "string" && refusal.trim()) return refusal.trim();
  if (typeof last === "string" && last.trim()) return last.trim();
  return null;
}

/** Retourne un timestamp ms pour le décompte 24h, ou null si non exploitable. */
export function resolveEvaluationCountdownStartMs(metadata: unknown, intakeUpdatedAtIso: string | null | undefined): number | null {
  const fromMeta = readIntakeMetaString(metadata, INTAKE_META_EVALUATION_STARTED_AT);
  if (fromMeta) {
    const p = Date.parse(fromMeta);
    if (!Number.isNaN(p)) return p;
  }
  if (intakeUpdatedAtIso && intakeUpdatedAtIso.trim()) {
    const p = Date.parse(intakeUpdatedAtIso.trim());
    if (!Number.isNaN(p)) return p;
  }
  return null;
}
