"use client";

import Link from "next/link";
import { Image as ImageIcon, Package, Pencil, Repeat2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { buildShippingIdsSearchParamsValue } from "@/lib/items/intake-shipping-metadata";
import { prefetchLendItemDetailIfNeeded } from "@/lib/items/lend-items-detail-cache";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";

type ExchangeLendItemRowProps = {
  id: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  currentValue: number | null;
  itemStatus: string;
  intake?: {
    listing_stage: string;
    fulfillment_stage: string | null;
    metadata?: unknown;
  } | null;
  photoUrl?: string | null;
  photoPosition?: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
  /** Unité affichée avec le prix (alignée sur le wallet). */
  creditKind: WalletCreditKind;
};

/** Prix connu côté membre après proposition (hors phase « en évaluation » seule). */
function hasConfirmedLendPrice(intake?: { listing_stage: string; fulfillment_stage: string | null } | null): boolean {
  const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (fs === "refused") return false;
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  return ls === "validation_pending" || ls === "evaluated" || ls === "validated";
}

function isLendPhysicallyVerified(intake?: { listing_stage: string; fulfillment_stage: string | null } | null): boolean {
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
  return ls === "validated" && fs === "verified";
}

function isEvaluationRefused(
  status: string,
  intake?: { listing_stage: string; fulfillment_stage: string | null } | null,
): boolean {
  const normalized = status.trim().toLowerCase();
  const listingStage = intake?.listing_stage?.toLowerCase() ?? "";
  const fulfillmentStage = intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (listingStage === "validated" && fulfillmentStage === "refused") return false;
  return normalized === "refused" || normalized === "draft_deleted" || listingStage === "refused";
}

function isLogisticsRefused(
  status: string,
  intake?: { listing_stage: string; fulfillment_stage: string | null } | null,
): boolean {
  const listingStage = intake?.listing_stage?.toLowerCase() ?? "";
  const fulfillmentStage = intake?.fulfillment_stage?.toLowerCase() ?? "";
  return listingStage === "validated" && fulfillmentStage === "refused";
}

function getStatusLabel(
  status: string,
  intake?: { listing_stage: string; fulfillment_stage: string | null } | null,
): string {
  const normalized = status.trim().toLowerCase();
  const intakeListingStage = intake?.listing_stage?.toLowerCase() ?? null;
  const intakeFulfillmentStage = intake?.fulfillment_stage?.toLowerCase() ?? null;

  // Priorité visuelle: "retired" = processus de récupération en cours côté membre.
  if (normalized === "retired") {
    return "Récupération en cours";
  }

  if (isEvaluationRefused(status, intake)) {
    return "Refusé";
  }

  if (isLogisticsRefused(status, intake) || intakeFulfillmentStage === "refused") {
    return "Refus contrôle";
  }

  // Pipeline validée + contrôle OK : si la pièce est déjà `available` en DB, c’est le statut catalogue (bleu), pas l’étape « Vérifiée ».
  if (intakeListingStage === "validated") {
    if (intakeFulfillmentStage === "pre_subscribe_eligible") return "Éligible (validation)";
    if (intakeFulfillmentStage === "awaiting_subscription" || intakeFulfillmentStage === "shipping") {
      return "Expédition";
    }
    if (intakeFulfillmentStage === "in_verification") return "Vérification";
    if (intakeFulfillmentStage === "verified") {
      if (normalized === "available" || normalized === "disponible" || normalized === "in_cart") {
        return "Disponible";
      }
      return "Vérifiée";
    }
  }
  if (intakeListingStage === "evaluation") return "En évaluation";
  if (intakeListingStage === "evaluated") return "Évaluée";
  if (intakeListingStage === "validation_pending") return "Prix à confirmer";

  if (normalized === "draft" || normalized === "brouillon") {
    if (intake?.listing_stage === "validated") {
      const fs = intake.fulfillment_stage?.toLowerCase() ?? "";
      if (fs === "pre_subscribe_eligible") return "Éligible (validation)";
      if (fs === "awaiting_subscription" || fs === "shipping") return "Expédition";
      if (fs === "in_verification") return "Vérification";
      if (fs === "verified") {
        const st = status.trim().toLowerCase();
        if (st === "available" || st === "disponible" || st === "in_cart") {
          return "Disponible";
        }
        return "Vérifiée";
      }
    }
    if (intake?.listing_stage === "evaluation") return "En évaluation";
    if (intake?.listing_stage === "evaluated") return "Évaluée";
    if (intake?.listing_stage === "validation_pending") return "Prix à confirmer";
    return "Brouillon";
  }
  if (normalized === "in_cart") return "Disponible";
  if (normalized.includes("reserved") || normalized.includes("emprunt")) return "Emprunt en cours";
  if (normalized === "listed") return "Catalogue (indisponible)";
  if (normalized === "available" || normalized === "disponible") return "Disponible";
  return status || "Inconnu";
}

function statusPillClassName(
  status: string,
  intake?: { listing_stage: string; fulfillment_stage: string | null } | null,
): string {
  const normalized = status.trim().toLowerCase();
  const intakeListingStage = intake?.listing_stage?.toLowerCase() ?? null;
  const intakeFulfillmentStage = intake?.fulfillment_stage?.toLowerCase() ?? null;

  if (normalized === "retired") return "bg-amber-100 text-amber-900";

  if (isEvaluationRefused(status, intake)) {
    return "bg-[#E44D3E] text-white";
  }

  if (isLogisticsRefused(status, intake) || intakeFulfillmentStage === "refused") {
    return "bg-rose-100 text-rose-900";
  }

  // Priorité affichage sur la pipeline (fulfillment).
  if (intakeListingStage === "validated") {
    if (intakeFulfillmentStage === "pre_subscribe_eligible") return "bg-violet-100 text-violet-900";
    if (intakeFulfillmentStage === "awaiting_subscription" || intakeFulfillmentStage === "shipping") {
      return "bg-blue-100 text-blue-700";
    }
    if (intakeFulfillmentStage === "in_verification") return "bg-amber-100 text-amber-900";
    if (intakeFulfillmentStage === "verified") {
      if (normalized === "available" || normalized === "disponible" || normalized === "in_cart") {
        return "bg-blue-100 text-blue-800";
      }
      return "bg-emerald-100 text-emerald-900";
    }
  }
  if (intakeListingStage === "validation_pending") return "bg-[#E7772C] text-white";

  if (normalized === "draft" || normalized === "brouillon") {
    if (intake?.listing_stage === "validated") {
      const fs = intake.fulfillment_stage?.toLowerCase() ?? "";
      if (fs === "pre_subscribe_eligible") return "bg-violet-100 text-violet-900";
      if (fs === "awaiting_subscription" || fs === "shipping") return "bg-blue-100 text-blue-700";
      if (fs === "in_verification") return "bg-amber-100 text-amber-900";
      if (fs === "verified") {
        const st = status.trim().toLowerCase();
        if (st === "available" || st === "disponible" || st === "in_cart") {
          return "bg-blue-100 text-blue-800";
        }
        return "bg-emerald-100 text-emerald-900";
      }
    }
    return "bg-[#E7772C] text-white";
  }
  if (normalized === "in_cart") return "bg-emerald-100 text-emerald-700";
  if (normalized.includes("reserved") || normalized.includes("emprunt")) return "bg-blue-100 text-blue-700";
  if (normalized === "listed") return "bg-sky-100 text-sky-900";
  if (normalized === "available" || normalized === "disponible") return "bg-emerald-100 text-emerald-700";
  return "bg-zinc-100 text-zinc-700";
}

function splitNameAndBrand(name: string): { title: string; brand: string | null } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*)\(([^)]+)\)\s*$/);
  if (!match) return { title: trimmed, brand: null };
  return { title: match[1]?.trim() || trimmed, brand: match[2]?.trim() || null };
}

function isDraftLike(status: string, intake?: { listing_stage: string; fulfillment_stage: string | null } | null): boolean {
  const normalized = status.trim().toLowerCase();
  const listingStage = intake?.listing_stage?.trim().toLowerCase() ?? "";
  if (normalized === "listed") return false;
  if (listingStage && listingStage !== "draft") return false;
  if (normalized === "draft" || normalized === "brouillon") {
    if (intake?.listing_stage === "validated" && intake.fulfillment_stage === "verified") return false;
    return true;
  }
  return false;
}

function canEditEvaluationDraft(status: string, intake?: { listing_stage: string; fulfillment_stage: string | null } | null): boolean {
  const normalized = status.trim().toLowerCase();
  const listingStage = intake?.listing_stage?.trim().toLowerCase() ?? "";
  return (normalized === "draft" || normalized === "brouillon") && (listingStage === "evaluation" || listingStage === "evaluated");
}

function isFulfillmentShipping(intake?: { listing_stage: string; fulfillment_stage: string | null } | null) {
  const ls = intake?.listing_stage?.toLowerCase() ?? "";
  if (ls !== "validated") return false;
  return (intake?.fulfillment_stage?.toLowerCase() ?? "") === "shipping";
}

export function ExchangeLendItemRow({
  id,
  name,
  description,
  brand: brandProp,
  currentValue,
  itemStatus,
  intake,
  photoUrl,
  photoPosition,
  creditKind,
}: ExchangeLendItemRowProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const { title, brand: brandFromName } = splitNameAndBrand(name);
  const brand = brandProp ?? brandFromName;
  const evaluationRefused = isEvaluationRefused(itemStatus, intake);
  const showEditDelete = isDraftLike(itemStatus, intake);
  const showEvaluationEdit = canEditEvaluationDraft(itemStatus, intake);
  const shippingQuickAction = isFulfillmentShipping(intake);
  const showPriceRow =
    !evaluationRefused &&
    currentValue != null &&
    Number.isFinite(currentValue) &&
    currentValue > 0 &&
    hasConfirmedLendPrice(intake);
  const priceVerifiedLook = isLendPhysicallyVerified(intake);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsDeleting(false);
      return;
    }

    const { error } = await supabase
      .from("items")
      .update({
        ...(evaluationRefused ? { status: "draft_deleted" as const } : {}),
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);
    setIsDeleting(false);
    if (error) return;
    try {
      const activeDraftId = window.sessionStorage.getItem("segna:new-item:active-draft-id");
      if (activeDraftId === id) {
        window.sessionStorage.removeItem("segna:new-item:active-draft-id");
        window.sessionStorage.removeItem("segna:new-item:slots-draft");
      }
    } catch {
      // no-op
    }
    setIsDeleted(true);
    router.refresh();
  };

  if (isDeleted) return null;

  return (
    <article
      className={cn(
        "relative grid w-full grid-cols-[100px_minmax(0,50%)_auto] items-center gap-1 py-2",
      )}
    >
      {evaluationRefused ? (
        <div
          className="pointer-events-auto absolute inset-y-0 left-1/2 z-[15] w-screen -translate-x-1/2 bg-zinc-900/38 backdrop-blur-md backdrop-saturate-125"
          aria-hidden
        />
      ) : null}
      {evaluationRefused ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="max-w-[min(100%,22rem)] truncate text-[18px] font-semibold italic leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
            {title}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/items/${id}`}
              className="inline-flex h-11 min-w-[128px] items-center justify-center whitespace-nowrap rounded-full bg-white px-5 text-center text-[14px] font-semibold text-zinc-950 shadow-sm transition active:scale-[0.98]"
            >
              Voir refus
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex h-11 min-w-[158px] items-center justify-center whitespace-nowrap rounded-full bg-zinc-950 px-5 text-center text-[14px] font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
            >
              {isDeleting ? "Suppression…" : "Supprimer l'item"}
            </button>
          </div>
        </div>
      ) : null}
      {!evaluationRefused ? (
        <Link
          href={`/items/${id}`}
          aria-label={`Voir la pièce ${title}`}
          className="absolute inset-0 z-0"
          onPointerEnter={() => {
            void prefetchLendItemDetailIfNeeded(id);
          }}
          onTouchStart={() => {
            void prefetchLendItemDetailIfNeeded(id);
          }}
        />
      ) : null}

      <div className={cn("pointer-events-none relative flex items-center", !evaluationRefused && "z-10")}>
        {photoUrl ? (
          <RemoteCoverThumb photoUrl={photoUrl} photoPosition={photoPosition} frameClassName="aspect-square w-[100px] shrink-0 rounded-md" />
        ) : (
          <div className="flex aspect-square w-[100px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-200 text-zinc-400">
            <ImageIcon className="h-7 w-7" aria-hidden />
          </div>
        )}
      </div>

      <div className={cn("pointer-events-none relative flex min-w-0 flex-1 items-center justify-start px-1", !evaluationRefused && "z-10")}>
        <div className="min-w-0 flex-1">
          <div>
            <p className="text-[18px] font-semibold italic leading-[1.15] text-zinc-900 break-words">
              {title}
            </p>
            {brand ? <span className="font-semibold text-[16px] not-italic"> ({brand})</span> : null}
            {description ? <p className="mt-1 text-[13px] leading-[1.3] text-zinc-500 break-words">{description}</p> : null}
            {showPriceRow && currentValue != null ? (
              <p
                className={cn(
                  "mt-1 text-[15px] tracking-tight",
                  priceVerifiedLook ? "font-semibold text-zinc-900" : "font-medium text-zinc-500",
                )}
              >
                <SegnaPointsUnitDisplay
                  points={currentValue}
                  creditKind={creditKind}
                  numberClassName={cn(
                    "text-[15px] tabular-nums",
                    priceVerifiedLook ? "font-semibold text-zinc-900" : "font-medium text-zinc-500",
                  )}
                />
              </p>
            ) : null}
          </div>
          {!evaluationRefused ? (
            <span
              className={cn(
                "relative z-20 mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                statusPillClassName(itemStatus, intake),
              )}
            >
              {getStatusLabel(itemStatus, intake)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative z-30 flex items-center justify-end gap-1 pr-0">
        {evaluationRefused ? null : shippingQuickAction ? (
          <Link
            href={`/items/shipping?ids=${buildShippingIdsSearchParamsValue(id, intake?.metadata)}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
            aria-label="Page expédition — bordereau et suivi"
          >
            <Package className="h-5 w-5" aria-hidden />
          </Link>
        ) : showEvaluationEdit ? (
          <Link
            href={`/items/new?itemId=${encodeURIComponent(id)}&from=item`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
            aria-label="Modifier l'item"
          >
            <Pencil className="h-5 w-5" />
          </Link>
        ) : showEditDelete ? (
          <>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
              aria-label="Supprimer l'item"
            >
              <Trash2 className={cn("h-5 w-5", isDeleting ? "opacity-40" : "")} />
            </button>
            <Link
              href={`/items/new?itemId=${encodeURIComponent(id)}&from=item`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
              aria-label="Modifier l'item"
            >
              <Pencil className="h-5 w-5" />
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setReturnConfirmOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
            aria-label="Demander un retour"
          >
            <Repeat2 className="h-5 w-5" />
          </button>
        )}
      </div>
      {returnConfirmOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`confirm-return-${id}`}
          >
            <SegnaDialogDismissButton onClick={() => setReturnConfirmOpen(false)} />
            <h2
              id={`confirm-return-${id}`}
              className={segnaDialogTitleClass("pr-10 text-[20px] sm:text-[22px]")}
            >
              Récupérer cette pièce ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Tu vas démarrer une demande de retour. Tu pourras ensuite confirmer l&apos;expédition depuis la page retour.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReturnConfirmOpen(false)}
                className="h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800"
              >
                Non
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnConfirmOpen(false);
                  router.push(`/items/${encodeURIComponent(id)}/retour`);
                }}
                className="h-10 rounded-lg bg-zinc-900 text-sm font-semibold text-white"
              >
                Oui, récupérer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
