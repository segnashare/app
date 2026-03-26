/** Clés optionnelles renseignées côté back office dans `item_intake.metadata`. */
export const INTAKE_META_REFUSAL_MESSAGE = "refusal_member_message";
export const INTAKE_META_COMPLEMENT_MESSAGE = "complement_member_message";
/** ISO / timestamptz texte Postgres, posé au passage en `listing_stage = evaluation`. */
export const INTAKE_META_EVALUATION_STARTED_AT = "evaluation_started_at";

export function readIntakeMetaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
