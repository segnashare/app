"use client";

import Link from "next/link";
import { Montserrat, Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  INTAKE_META_COMPLEMENT_MESSAGE,
  INTAKE_META_REFUSAL_MESSAGE,
  readIntakeMetaString,
  readLogisticsRefusalNote,
  resolveEvaluationCountdownStartMs,
} from "@/lib/items/intake-metadata";
import { buildShippingIdsSearchParamsValue } from "@/lib/items/intake-shipping-metadata";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["600", "500"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["700"] });

const EYE_ART_SRC = "/ressources/Oeil/Oeil%20cils+fond.svg";

export function needsItemIntakeUi(listingStage: string | null | undefined, fulfillmentStage: string | null | undefined) {
  return Boolean(
    listingStage &&
      (["evaluation", "validation_pending", "evaluated", "refused"].includes(listingStage) ||
        (listingStage === "validated" && fulfillmentStage != null && fulfillmentStage !== "verified")),
  );
}

const EVALUATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatCountdownHms(remainingMs: number): string {
  if (remainingMs <= 0) return "00:00:00";
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function EvaluationCountdown({ startedAtMs }: { startedAtMs: number }) {
  const deadlineMs = startedAtMs + EVALUATION_WINDOW_MS;
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, deadlineMs - Date.now());
  const label = formatCountdownHms(remaining);
  return (
    <div
      className={cn(montserrat.className, "flex shrink-0 flex-col items-end gap-0.5 text-right")}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Sous 24 h</span>
      <span
        role="timer"
        className="font-mono text-[17px] font-semibold tabular-nums text-[#5E3023] sm:text-[18px]"
      >
        {label}
      </span>
    </div>
  );
}

type IntakePanelLayoutProps = {
  kicker: string;
  title: string;
  titleId: string;
  titleRight?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

function IntakePanelLayout({ kicker, title, titleId, titleRight, children, footer }: IntakePanelLayoutProps) {
  return (
    <div
      className="mx-auto w-full max-w-[460px] px-4 py-4 sm:px-5"
      role="region"
      aria-labelledby={titleId}
    >
      <div className="flex gap-3 sm:gap-4">
        <div className="relative hidden w-[72px] shrink-0 sm:flex sm:items-start sm:justify-center">
          <div
            className="pointer-events-none absolute inset-0 rounded-xl opacity-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-42deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 7px)",
            }}
            aria-hidden
          />
          <img src={EYE_ART_SRC} alt="" className="relative z-[1] mt-1 h-14 w-auto object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(montserrat.className, "text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500")}
          >
            {kicker}
          </p>
          <div className="mt-1 flex flex-row items-start justify-between gap-3">
            <h2
              id={titleId}
              className={cn(
                playfair.className,
                "min-w-0 flex-1 text-left text-[19px] leading-snug text-zinc-900 sm:text-[20px]",
              )}
            >
              {title}
            </h2>
            {titleRight ? <div className="shrink-0 pt-0.5">{titleRight}</div> : null}
          </div>
          <div className={cn(montserrat.className, "mt-2 text-left text-[14px] leading-relaxed text-zinc-600 sm:text-[15px]")}>
            {children}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export type ItemIntakePanelProps = {
  itemId: string;
  listingStage: string;
  fulfillmentStage: string | null;
  intakeMetadata: unknown;
  /** `item_intake.updated_at` (ISO) — secours si `metadata.evaluation_started_at` absent. */
  intakeUpdatedAt?: string | null;
  offerPricePoints: number | null;
  onPipelineUpdated: () => void;
  /** Sur la page analyse : pas de lien « Voir l'analyse », offre + refus/accept ici. */
  placement: "item" | "evaluation";
};

export function ItemIntakePanel({
  itemId,
  listingStage,
  fulfillmentStage,
  intakeMetadata,
  intakeUpdatedAt,
  offerPricePoints,
  onPipelineUpdated,
  placement,
}: ItemIntakePanelProps) {
  const router = useRouter();
  const [userMinimized, setUserMinimized] = useState(false);
  const [refuseConfirmOpen, setRefuseConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefusing, setIsRefusing] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

  const refusalText =
    readIntakeMetaString(intakeMetadata, INTAKE_META_REFUSAL_MESSAGE) ??
    "Ta pièce ne correspond pas aux critères d’entrée au catalogue Segna pour le moment. Tu peux proposer une autre pièce quand tu veux.";

  const complementText =
    readIntakeMetaString(intakeMetadata, INTAKE_META_COMPLEMENT_MESSAGE) ??
    "Notre équipe a besoin de précisions ou d’éléments complémentaires (photos, description, détails d’état…) pour poursuivre l’analyse. Mets à jour ta fiche puis renvoie-la.";

  const isLogisticsRefused = listingStage === "validated" && fulfillmentStage === "refused";

  const showFulfillment =
    listingStage === "validated" &&
    fulfillmentStage != null &&
    fulfillmentStage !== "verified" &&
    fulfillmentStage !== "refused";

  const canMinimize =
    listingStage === "evaluation" || listingStage === "evaluated" || showFulfillment;

  const pipelineVisible =
    showFulfillment ||
    isLogisticsRefused ||
    listingStage === "evaluation" ||
    listingStage === "validation_pending" ||
    listingStage === "evaluated" ||
    listingStage === "refused";

  const visible = pipelineVisible && (!canMinimize || !userMinimized);

  const handleRefuseOffer = useCallback(async () => {
    setActionError(null);
    setIsRefusing(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsRefusing(false);
      setActionError("Session invalide.");
      return;
    }
    const { error } = await supabase
      .from("items")
      .update({ status: "draft_deleted" })
      .eq("id", itemId)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);
    if (error) {
      setIsRefusing(false);
      setActionError(error.message);
      return;
    }
    const intakeRes = await setItemIntakeListingStage(supabase, itemId, "refused");
    setIsRefusing(false);
    setRefuseConfirmOpen(false);
    if (!intakeRes.ok) {
      setActionError(intakeRes.message);
      return;
    }
    try {
      const activeDraftId = window.sessionStorage.getItem("segna:new-item:active-draft-id");
      if (activeDraftId === itemId) {
        window.sessionStorage.removeItem("segna:new-item:active-draft-id");
        window.sessionStorage.removeItem("segna:new-item:slots-draft");
        window.sessionStorage.removeItem("segna:new-item:text-draft");
      }
    } catch {
      // no-op
    }
    router.push("/exchange");
  }, [itemId, router]);

  const handleAcceptOffer = useCallback(async () => {
    setActionError(null);
    setIsAccepting(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const intakeRes = await setItemIntakeListingStage(supabase, itemId, "validated");
    setIsAccepting(false);
    if (!intakeRes.ok) {
      setActionError(intakeRes.message);
      return;
    }
    onPipelineUpdated();
    router.push(`/items/${itemId}`);
  }, [itemId, onPipelineUpdated, router]);

  if (!visible) return null;

  if (listingStage === "evaluation") {
    const evalStartMs = resolveEvaluationCountdownStartMs(intakeMetadata, intakeUpdatedAt ?? null);
    return (
      <IntakePanelLayout
        kicker="Suivi annonce"
        title="Soumis pour analyse"
        titleId="intake-title-evaluation"
        titleRight={evalStartMs != null ? <EvaluationCountdown startedAtMs={evalStartMs} /> : null}
        footer={
          <button
            type="button"
            onClick={() => setUserMinimized(true)}
            className={cn(
              montserrat.className,
              "h-11 w-full rounded-full bg-[#5E3023] text-[14px] font-semibold text-white sm:w-auto sm:min-w-[140px]",
            )}
          >
            Compris
          </button>
        }
      >
        <p>
          Ton annonce est en cours d&apos;évaluation et de vérification côté Segna. Tu recevras une décision ou une suite
          à donner sous 24 heures.
        </p>
      </IntakePanelLayout>
    );
  }

  if (listingStage === "validation_pending") {
    const pts = offerPricePoints != null && Number.isFinite(offerPricePoints) ? Math.round(offerPricePoints) : null;

    const floatingCardClass =
      "rounded-[18px] bg-[#F3E8DF] px-3.5 py-3 shadow-[0_6px_24px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]";

    if (placement === "item") {
      const phrase =
        pts != null
          ? `Proposition à ${pts} points — ouvre l'analyse pour répondre.`
          : "Segna te fait une proposition — ouvre l'analyse pour répondre.";
      return (
        <div
          role="region"
          aria-label="Offre Segna"
          className={cn(montserrat.className, "flex items-center gap-3", floatingCardClass)}
        >
          <Link
            href={`/items/${itemId}/evaluation`}
            className="shrink-0 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#5E3023] shadow-sm ring-1 ring-black/[0.06]"
          >
            Voir l&apos;analyse
          </Link>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-800">{phrase}</p>
        </div>
      );
    }

    return (
      <>
        <div
          role="region"
          aria-labelledby="intake-title-validation-pending-eval"
          className={cn(montserrat.className, floatingCardClass, "flex flex-col gap-2")}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setRefuseConfirmOpen(true);
                }}
                disabled={isAccepting || isRefusing}
                className="rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-zinc-800 shadow-sm ring-1 ring-black/[0.06] disabled:opacity-50"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() => void handleAcceptOffer()}
                disabled={isAccepting || isRefusing}
                className="rounded-full bg-[#5E3023] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {isAccepting ? "…" : "Accepter"}
              </button>
            </div>
            <p id="intake-title-validation-pending-eval" className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-800">
              {pts != null
                ? `${pts} points proposés — accepte ou refuse l’entrée au catalogue.`
                : "Une entrée au catalogue t’est proposée — accepte ou refuse."}
            </p>
          </div>
          {actionError ? <p className="text-[12px] text-[#E44D3E]">{actionError}</p> : null}
        </div>
        {refuseConfirmOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="presentation">
            <div
              className="w-full max-w-[340px] rounded-2xl bg-white p-5 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="refuse-offer-title"
            >
              <h3 id="refuse-offer-title" className={cn(montserrat.className, "text-lg font-semibold text-zinc-900")}>
                Refuser cette offre ?
              </h3>
              <p className={cn(montserrat.className, "mt-2 text-sm text-zinc-600")}>
                Ta fiche sera retirée de la file d&apos;entrée. Tu pourras créer une nouvelle annonce plus tard.
              </p>
              {actionError ? <p className="mt-2 text-sm text-[#E44D3E]">{actionError}</p> : null}
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRefuseConfirmOpen(false);
                    setActionError(null);
                  }}
                  disabled={isRefusing}
                  className={cn(montserrat.className, "h-11 rounded-xl border border-zinc-200 text-sm font-semibold")}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefuseOffer()}
                  disabled={isRefusing}
                  className={cn(
                    montserrat.className,
                    "h-11 rounded-xl bg-[#E44D3E] text-sm font-semibold text-white disabled:opacity-60",
                  )}
                >
                  {isRefusing ? "Traitement…" : "Confirmer le refus"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (listingStage === "evaluated") {
    return (
      <IntakePanelLayout
        kicker="Complément demandé"
        title="Des précisions sont nécessaires"
        titleId="intake-title-evaluated"
        footer={
          <>
            <Link
              href={`/items/new?itemId=${encodeURIComponent(itemId)}&from=item`}
              className={cn(
                montserrat.className,
                "flex h-11 w-full items-center justify-center rounded-full bg-[#5E3023] text-[14px] font-semibold text-white sm:w-auto sm:min-w-[200px]",
              )}
            >
              Compléter ma fiche
            </Link>
            <button
              type="button"
              onClick={() => setUserMinimized(true)}
              className={cn(
                montserrat.className,
                "h-10 text-[14px] font-semibold text-zinc-500 underline-offset-2 hover:underline sm:px-3",
              )}
            >
              Fermer
            </button>
          </>
        }
      >
        <p>{complementText}</p>
      </IntakePanelLayout>
    );
  }

  if (listingStage === "refused") {
    return (
      <IntakePanelLayout
        kicker="Annonce non retenue"
        title="Cette pièce ne correspond pas"
        titleId="intake-title-refused"
        footer={
          <button
            type="button"
            onClick={() => router.push("/exchange")}
            className={cn(
              montserrat.className,
              "h-11 w-full rounded-full bg-[#5E3023] text-[14px] font-semibold text-white sm:w-auto sm:min-w-[200px]",
            )}
          >
            Retour à l&apos;échange
          </button>
        }
      >
        <p>{refusalText}</p>
      </IntakePanelLayout>
    );
  }

  if (isLogisticsRefused) {
    const note = readLogisticsRefusalNote(intakeMetadata);
    return (
      <div
        role="region"
        aria-labelledby="intake-logistics-refused-title"
        className={cn(
          montserrat.className,
          "mx-auto flex w-full max-w-[460px] flex-col gap-3 rounded-[18px] border border-rose-200/90 bg-rose-50/80 px-3.5 py-3.5 shadow-[0_6px_24px_rgba(0,0,0,0.06)] ring-1 ring-rose-900/[0.06]",
        )}
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-800/90">Contrôle physique</p>
          <h2 id="intake-logistics-refused-title" className={cn(playfair.className, "mt-1 text-[18px] leading-snug text-zinc-900")}>
            Pièce non conforme — refus logistique
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-700">
            La pièce ne correspond pas à l&apos;annonce ou aux critères après réception. Un retour peut être mis en
            place (frais à ta charge sauf indication contraire). Consulte la page dédiée pour le motif et les prochaines
            étapes.
          </p>
          {note ? (
            <p className="mt-2 rounded-lg border border-rose-200/80 bg-white/90 px-3 py-2 text-[13px] text-zinc-800">
              <span className="font-semibold text-rose-900">Motif : </span>
              {note}
            </p>
          ) : null}
        </div>
        <Link
          href={`/items/${itemId}/refus-logistique`}
          className="flex h-11 items-center justify-center rounded-full bg-[#5E3023] px-5 text-[13px] font-semibold text-white shadow-sm"
        >
          Page refus &amp; suite à donner
        </Link>
      </div>
    );
  }

  if (showFulfillment) {
    return (
      <div
        role="region"
        aria-label="Suivi expédition"
        className={cn(
          montserrat.className,
          "mx-auto flex w-full max-w-[460px] items-center gap-3 rounded-[18px] bg-[#F3E8DF] px-3.5 py-3 shadow-[0_6px_24px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]",
        )}
      >
        <Link
          href={`/items/shipping?ids=${buildShippingIdsSearchParamsValue(itemId, intakeMetadata)}`}
          className="shrink-0 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#5E3023] shadow-sm ring-1 ring-black/[0.06]"
        >
          Bordereau d&apos;envoi
        </Link>
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-800">
          Prépare ton envoi et retrouve le suivi sur la page dédiée.
        </p>
      </div>
    );
  }

  return null;
}
