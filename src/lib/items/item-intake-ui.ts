/** Logique d’affichage pipeline item / item_intake (importable côté serveur). */

export function needsItemIntakeUi(
  listingStage: string | null | undefined,
  fulfillmentStage: string | null | undefined,
): boolean {
  return Boolean(
    listingStage &&
      (["evaluation", "validation_pending", "evaluated", "refused"].includes(listingStage) ||
        (listingStage === "validated" && fulfillmentStage != null && fulfillmentStage !== "verified")),
  );
}

export function normalizeItemIntakeEmbed(rawIntake: unknown): {
  listing_stage: string;
  fulfillment_stage: string | null;
  updated_at?: string | null;
  metadata?: unknown;
} | null {
  const intakeRow = Array.isArray(rawIntake)
    ? [...rawIntake]
        .filter((row) => row && typeof row === "object")
        .sort((a, b) =>
          String((b as { updated_at?: string | null }).updated_at ?? "").localeCompare(
            String((a as { updated_at?: string | null }).updated_at ?? ""),
          ),
        )[0]
    : rawIntake;
  if (!intakeRow || typeof intakeRow !== "object") return null;
  const row = intakeRow as Record<string, unknown>;
  return {
    listing_stage: String(row.listing_stage ?? ""),
    fulfillment_stage: row.fulfillment_stage != null ? String(row.fulfillment_stage) : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    metadata: "metadata" in row ? row.metadata : undefined,
  };
}

const statusSortOrder: Record<string, number> = {
  available: 0,
  in_cart: 0,
  listed: 1,
  draft: 3,
  reserved: 3,
};

/** Plus la valeur est basse, plus l’étape pipeline est avancée (affichage en premier). */
export function lendPipelineRank(
  itemStatus: string,
  intake: { listing_stage: string; fulfillment_stage: string | null } | null,
): number {
  const st = itemStatus.toLowerCase();
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (st === "refused" || st === "draft_deleted" || ls === "refused" || fs === "refused") return -1;
  if (ls === "validated") {
    if (fs === "verified") return 0;
    if (fs === "in_verification") return 1;
    if (fs === "shipping" || fs === "pre_subscribe_eligible" || fs === "awaiting_subscription" || fs === "") return 2;
  }
  if (ls === "validation_pending") return 3;
  if (ls === "evaluated") return 4;
  if (ls === "evaluation") return 5;
  return 6;
}

/** verified = disponible au catalogue : même rang de tri que `available`, pas `listed`. */
export function effectiveCatalogSortRank(
  itemStatus: string,
  intake: { listing_stage: string; fulfillment_stage: string | null } | null,
): number {
  const key = itemStatus.toLowerCase();
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (key === "refused" || key === "draft_deleted" || ls === "refused" || fs === "refused") return -1;
  if (ls === "validated" && fs === "verified") return statusSortOrder.available;
  return statusSortOrder[key] ?? 3;
}
