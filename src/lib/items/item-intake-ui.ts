/** Logique d’affichage pipeline item / item_intake (importable côté serveur). */

import { normalizeIntakeFulfillmentStage } from "@/lib/items/intake-fulfillment-stages";

function validatedIntakeShowsMemberPipelineUi(fulfillmentStage: string | null | undefined): boolean {
  const fs = normalizeIntakeFulfillmentStage(fulfillmentStage);
  if (!fs) return true;
  return fs !== "verified" && fs !== "in_verification" && fs !== "refused";
}

export function needsItemIntakeUi(
  listingStage: string | null | undefined,
  fulfillmentStage: string | null | undefined,
): boolean {
  const ls = String(listingStage ?? "").trim().toLowerCase();
  return Boolean(
    ls &&
      (["evaluation", "validation_pending", "evaluated", "refused"].includes(ls) ||
        (ls === "validated" && validatedIntakeShowsMemberPipelineUi(fulfillmentStage))),
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
    if (fs === "shipping") return 2;
    if (fs === "ready" || fs === "") return 3;
  }
  if (ls === "validation_pending") return 3;
  if (ls === "evaluated") return 4;
  if (ls === "evaluation") return 5;
  return 6;
}

/** verified = disponible au catalogue : même rang de tri que `available`. */
export function effectiveCatalogSortRank(
  itemStatus: string,
  intake: { listing_stage: string; fulfillment_stage: string | null } | null,
): number {
  const raw = itemStatus.toLowerCase();
  const key = raw === "listed" ? "available" : raw;
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (key === "refused" || key === "draft_deleted" || ls === "refused" || fs === "refused") return -1;
  if (ls === "validated" && fs === "verified") return statusSortOrder.available;
  return statusSortOrder[key] ?? 3;
}
