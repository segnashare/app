/** Affichage membre : issue litige par pièce (perte / défaut). */

export type MemberItemDisputeSettlementKind = "loss" | "defect";

export function memberItemDisputeSettlementKind(input: {
  tier?: string | null;
  disposition?: string | null;
}): MemberItemDisputeSettlementKind {
  const tier = String(input.tier ?? "").trim();
  const disposition = String(input.disposition ?? "").trim();
  if (tier === "non_return" || disposition === "lost_not_returned") return "loss";
  return "defect";
}

export function memberItemDisputeSettlementBadge(
  kind: MemberItemDisputeSettlementKind,
): string {
  return kind === "loss" ? "Perte" : "Défaut";
}

/** Ligne secondaire sous le titre article — sans redondance avec la pastille. */
export function memberItemDisputeSettlementSummary(input: {
  kind: MemberItemDisputeSettlementKind;
  tierLabel?: string | null;
  amountLabel?: string | null;
  chargeStatusLabel?: string | null;
}): string {
  const parts: string[] = [];
  if (input.kind === "defect" && input.tierLabel?.trim()) {
    parts.push(input.tierLabel.trim());
  }
  if (input.amountLabel?.trim()) parts.push(input.amountLabel.trim());
  if (input.chargeStatusLabel?.trim()) parts.push(input.chargeStatusLabel.trim());
  return parts.join(" · ");
}
