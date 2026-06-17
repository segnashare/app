"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import {
  INTAKE_META_COMPLEMENT_MESSAGE,
  INTAKE_META_REFUSAL_MESSAGE,
  readIntakeMetaString,
  readLogisticsRefusalNote,
  resolveEvaluationCountdownStartMs,
} from "@/lib/items/intake-metadata";
import {
  INTAKE_FULFILLMENT_SHIPPING,
  intakeShowsPrepareShipmentCard,
  memberIntakeShipmentIndicatesMemberInTransit,
} from "@/lib/items/intake-fulfillment-stages";
import {
  buildShippingPageHref,
  readMemberIntakeShipmentIdFromMetadata,
  resolveShippingItemIdsForLink,
} from "@/lib/items/intake-shipping-metadata";
import { resolveActiveMemberIntakeShipmentIdForItems } from "@/lib/items/member-intake-shipment";
import {
  memberIntakeInTransitShippingBody,
  memberIntakeShippingCtaLabel,
  memberIntakeShippingGroupTitles,
  type MemberIntakeShippingGroupItem,
} from "@/lib/items/member-intake-shipping-copy";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
  SegnaDialogTitleRow,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

export { needsItemIntakeUi } from "@/lib/items/item-intake-ui";

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const label = formatCountdownHms(Math.max(0, deadlineMs - nowMs));
  return (
    <div
      className={cn(montserrat.className, "flex shrink-0 flex-col items-end gap-0.5 text-right")}
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        role="timer"
        className="font-mono text-[17px] font-semibold tabular-nums text-zinc-900 sm:text-[18px]"
      >
        {label}
      </span>
    </div>
  );
}

type IntakePanelLayoutProps = {
  title: string;
  titleId: string;
  titleRight?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

function IntakePanelLayout({ title, titleId, titleRight, children, footer }: IntakePanelLayoutProps) {
  return (
    <div
      className="mx-auto w-full max-w-[460px] px-4 py-4 sm:px-5"
      role="region"
      aria-labelledby={titleId}
    >
      <SegnaDialogTitleRow id={titleId} title={title} right={titleRight} />
      <div className={cn(segnaDialogBodyClass(), "mt-2 text-left")}>{children}</div>
      <div className={cn(segnaDialogMontserrat.className, "mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3")}>
        {footer}
      </div>
    </div>
  );
}

function mergeIntakeTitleRight(onDismiss: (() => void) | undefined, existing: ReactNode | undefined): ReactNode | undefined {
  const close =
    onDismiss != null ? (
      <SegnaDialogDismissButton key="stack-dismiss" variant="inline" onClick={onDismiss} />
    ) : null;
  if (!close && !existing) return undefined;
  return (
    <div className="flex shrink-0 items-start gap-2">
      {existing}
      {close}
    </div>
  );
}

export type ItemIntakePanelProps = {
  itemId: string;
  /** Titre affiché sur le CTA expédition (ex. « Expédie Robe noire »). */
  itemTitle?: string | null;
  listingStage: string;
  fulfillmentStage: string | null;
  intakeMetadata: unknown;
  /** `item_intake.updated_at` (ISO) — secours si `metadata.evaluation_started_at` absent. */
  intakeUpdatedAt?: string | null;
  offerPricePoints: number | null;
  onPipelineUpdated: () => void;
  /** Sur la page analyse : pas de lien « Voir l'analyse », offre + refus/accept ici. */
  placement: "item" | "evaluation";
  /** Après « Compris » : masque ce statut pour la session courante. */
  onEvaluationAcknowledged?: () => void;
  /** Pile Échange : après « Compris » / « Fermer » pour passer à la carte suivante. */
  onExchangeStackAdvance?: () => void;
  /** Pile Échange : croix en-tête — masque la carte (session) sans action métier. */
  onStackDismiss?: () => void;
  /** Lot expédition par défaut (toutes les pièces prêtes du membre). */
  defaultShippingGroupIds?: string[];
  /** Titres des pièces du lot (optionnel — sinon chargés côté client). */
  shippingGroupItems?: MemberIntakeShippingGroupItem[];
};

export function ItemIntakePanel({
  itemId,
  itemTitle,
  listingStage,
  fulfillmentStage,
  intakeMetadata,
  intakeUpdatedAt,
  offerPricePoints,
  onPipelineUpdated,
  placement,
  onEvaluationAcknowledged,
  onExchangeStackAdvance,
  onStackDismiss,
  defaultShippingGroupIds,
  shippingGroupItems,
}: ItemIntakePanelProps) {
  const router = useRouter();
  const [resolvedGroupItems, setResolvedGroupItems] = useState<MemberIntakeShippingGroupItem[]>(
    shippingGroupItems ?? [],
  );
  const [userMinimized, setUserMinimized] = useState(false);
  const [refuseConfirmOpen, setRefuseConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefusing, setIsRefusing] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeletingRefusedItem, setIsDeletingRefusedItem] = useState(false);
  const [memberIntakeShipmentStatus, setMemberIntakeShipmentStatus] = useState<string | null>(null);
  const refusalText =
    readIntakeMetaString(intakeMetadata, INTAKE_META_REFUSAL_MESSAGE) ??
    "Ta pièce ne correspond pas aux critères d’entrée au catalogue Segna pour le moment. Tu peux proposer une autre pièce quand tu veux.";

  const complementText =
    readIntakeMetaString(intakeMetadata, INTAKE_META_COMPLEMENT_MESSAGE) ??
    "Notre équipe a besoin de précisions ou d’éléments complémentaires (photos, description, détails d’état…) pour poursuivre l’analyse. Mets à jour ta fiche puis renvoie-la.";

  const isLogisticsRefused = listingStage === "validated" && fulfillmentStage === "refused";

  /** Bordereau / mutualisation : validated + `ready` (ou legacy `fulfillment_stage` null avant backfill). */
  const showFulfillment = intakeShowsPrepareShipmentCard(listingStage, fulfillmentStage);
  const fulfillmentIsShipping =
    String(fulfillmentStage ?? "").trim().toLowerCase() === INTAKE_FULFILLMENT_SHIPPING ||
    memberIntakeShipmentIndicatesMemberInTransit(memberIntakeShipmentStatus);

  const shippingGroupIds = useMemo(
    () => resolveShippingItemIdsForLink(itemId, intakeMetadata, defaultShippingGroupIds),
    [itemId, intakeMetadata, defaultShippingGroupIds],
  );

  useEffect(() => {
    if (!showFulfillment) {
      setMemberIntakeShipmentStatus(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
      const supabase = createSupabaseBrowserClient() as any;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const metadataShipId = readMemberIntakeShipmentIdFromMetadata(intakeMetadata);
      const activeShipId = await resolveActiveMemberIntakeShipmentIdForItems(
        supabase,
        shippingGroupIds.length > 0 ? shippingGroupIds : [itemId],
        metadataShipId,
      );
      if (!activeShipId || cancelled) {
        setMemberIntakeShipmentStatus(null);
        return;
      }
      const { data: shipRow } = await supabase
        .from("shipments")
        .select("status")
        .eq("id", activeShipId)
        .eq("context", "member_intake")
        .is("deleted_at", null)
        .maybeSingle();
      if (cancelled) return;
      setMemberIntakeShipmentStatus(
        typeof shipRow?.status === "string" ? shipRow.status.trim().toLowerCase() : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [showFulfillment, itemId, intakeMetadata, shippingGroupIds]);

  useEffect(() => {
    if (shippingGroupItems?.length) {
      setResolvedGroupItems(shippingGroupItems);
      return;
    }
    const ids = [...new Set(shippingGroupIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length <= 1) {
      setResolvedGroupItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
      const supabase = createSupabaseBrowserClient() as any;
      const { data } = await supabase.from("items").select("id, title").in("id", ids).is("deleted_at", null);
      if (cancelled) return;
      setResolvedGroupItems(
        (data ?? []).map((row: { id?: string; title?: string | null }) => ({
          id: String(row.id ?? ""),
          title: typeof row.title === "string" ? row.title : null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [shippingGroupIds, shippingGroupItems]);

  const shippingGroupTitles = useMemo(
    () =>
      memberIntakeShippingGroupTitles(
        itemId,
        itemTitle,
        shippingGroupIds,
        resolvedGroupItems.length > 0 ? resolvedGroupItems : shippingGroupItems,
      ),
    [itemId, itemTitle, shippingGroupIds, resolvedGroupItems, shippingGroupItems],
  );

  const shipItemLabel = useMemo(
    () =>
      memberIntakeShippingCtaLabel(fulfillmentIsShipping ? "track" : "ship", shippingGroupTitles),
    [fulfillmentIsShipping, shippingGroupTitles],
  );

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
      .update({ status: "refused" })
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
    trackClientEvent("item_price_confirmed", {
      item_id: itemId,
      surface: "item_detail_panel",
    });
    onPipelineUpdated();
    router.push(`/items/${itemId}`);
  }, [itemId, onPipelineUpdated, router]);

  const handleDeleteRefusedItem = useCallback(async () => {
    if (isDeletingRefusedItem) return;
    setActionError(null);
    setIsDeletingRefusedItem(true);
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsDeletingRefusedItem(false);
      setActionError("Session invalide.");
      return;
    }

    const { error } = await supabase
      .from("items")
      .update({ status: "draft_deleted" })
      .eq("id", itemId)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);

    setIsDeletingRefusedItem(false);
    if (error) {
      setActionError(error.message);
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
  }, [isDeletingRefusedItem, itemId, router]);

  if (!visible) return null;

  if (listingStage === "evaluation") {
    const evalStartMs = resolveEvaluationCountdownStartMs(intakeMetadata, intakeUpdatedAt ?? null);
    return (
      <IntakePanelLayout
        title="Soumis pour analyse"
        titleId="intake-title-evaluation"
        titleRight={mergeIntakeTitleRight(
          onStackDismiss,
          evalStartMs != null ? <EvaluationCountdown startedAtMs={evalStartMs} /> : undefined,
        )}
        footer={
          <button
            type="button"
            onClick={() => {
              onEvaluationAcknowledged?.();
              onExchangeStackAdvance?.();
              setUserMinimized(true);
            }}
            className={cn(
              montserrat.className,
              "h-11 w-full rounded-full bg-zinc-900 text-[14px] font-semibold text-white sm:w-auto sm:min-w-[140px]",
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

    const panelShell = "mx-auto w-full max-w-[460px] space-y-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm";

    if (placement === "item") {
      const phrase =
        pts != null
          ? `Proposition à ${pts} points, ouvre l'analyse pour répondre.`
          : "Segna te fait une proposition, ouvre l'analyse pour répondre.";
      return (
        <div
          role="region"
          aria-labelledby="intake-title-validation-pending-item"
          className={cn(montserrat.className, panelShell, "relative")}
        >
          {onStackDismiss ? <SegnaDialogDismissButton onClick={onStackDismiss} /> : null}
          <div className={onStackDismiss ? "pr-10" : undefined}>
            <SegnaDialogTitleRow id="intake-title-validation-pending-item" title="Proposition Segna" />
            <p className={segnaDialogBodyClass()}>{phrase}</p>
          </div>
          <Link
            href={`/items/${itemId}/evaluation`}
            className={cn(
              montserrat.className,
              "inline-flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 text-[14px] font-semibold text-white",
            )}
          >
            Voir l&apos;analyse
          </Link>
        </div>
      );
    }

    return (
      <>
        <div
          role="region"
          aria-labelledby="intake-title-validation-pending-eval"
          className={cn(montserrat.className, panelShell, "relative")}
        >
          {onStackDismiss ? <SegnaDialogDismissButton onClick={onStackDismiss} /> : null}
          <div className={onStackDismiss ? "pr-10" : undefined}>
            <SegnaDialogTitleRow
              id="intake-title-validation-pending-eval"
              title="Entrée au catalogue"
            />
            <p className={segnaDialogBodyClass()}>
              {pts != null
                ? `${pts} points proposés : accepte ou refuse l’entrée au catalogue.`
                : "Une entrée au catalogue t’est proposée : accepte ou refuse."}
            </p>
            {actionError ? <p className="text-[12px] text-[#E44D3E]">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setRefuseConfirmOpen(true);
                }}
                disabled={isAccepting || isRefusing}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-zinc-800 disabled:opacity-50"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={() => void handleAcceptOffer()}
                disabled={isAccepting || isRefusing}
                className="rounded-full bg-zinc-900 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {isAccepting ? "…" : "Accepter"}
              </button>
            </div>
          </div>
        </div>
        {refuseConfirmOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="presentation">
            <div
              className={cn(SEGNA_DIALOG_CARD_CLASS, "relative max-w-[340px]")}
              role="dialog"
              aria-modal="true"
              aria-labelledby="refuse-offer-title"
            >
              <SegnaDialogDismissButton
                onClick={() => {
                  setRefuseConfirmOpen(false);
                  setActionError(null);
                }}
              />
              <h3 id="refuse-offer-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
                Refuser cette offre ?
              </h3>
              <p className={cn(segnaDialogBodyClass(), "mt-2")}>
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
        title="Des précisions sont nécessaires"
        titleId="intake-title-evaluated"
        titleRight={mergeIntakeTitleRight(onStackDismiss, undefined)}
        footer={
          <>
            <Link
              href={`/items/new?itemId=${encodeURIComponent(itemId)}&from=item`}
              className={cn(
                montserrat.className,
                "flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 text-[14px] font-semibold text-white sm:w-auto sm:min-w-[200px]",
              )}
            >
              Compléter ma fiche
            </Link>
            <button
              type="button"
              onClick={() => {
                onExchangeStackAdvance?.();
                setUserMinimized(true);
              }}
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
    const isExchangeStackCard = Boolean(onStackDismiss);

    return (
      <IntakePanelLayout
        title="Refus de pièce"
        titleId="intake-title-refused"
        titleRight={mergeIntakeTitleRight(onStackDismiss, undefined)}
        footer={
          isExchangeStackCard ? (
            <Link
              href={`/items/${itemId}`}
              className={cn(
                montserrat.className,
                "flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 text-[14px] font-semibold text-white sm:w-auto sm:min-w-[200px]",
              )}
            >
              En savoir plus
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleDeleteRefusedItem()}
              disabled={isDeletingRefusedItem}
              className={cn(
                montserrat.className,
                "h-11 w-full rounded-full bg-zinc-900 text-[14px] font-semibold text-white disabled:opacity-60 sm:w-auto sm:min-w-[200px]",
              )}
            >
              {isDeletingRefusedItem ? "Suppression…" : "Supprimer l'item"}
            </button>
          )
        }
      >
        <p>
          {isExchangeStackCard
            ? "Votre pièce ne correspond pas aux critères de la collection Segna"
            : refusalText}
        </p>
        {!isExchangeStackCard && actionError ? <p className="mt-2 text-[12px] text-[#E44D3E]">{actionError}</p> : null}
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
          "relative mx-auto flex w-full max-w-[460px] flex-col gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/50 px-4 py-4 shadow-sm",
        )}
      >
        {onStackDismiss ? <SegnaDialogDismissButton onClick={onStackDismiss} /> : null}
        <div className="flex w-full min-w-0 flex-col gap-3">
          {onStackDismiss ? (
            <div className="pr-10">
              <SegnaDialogTitleRow
                id="intake-logistics-refused-title"
                title="Pièce non conforme — refus logistique"
                className="w-full"
              />
            </div>
          ) : (
            <SegnaDialogTitleRow
              id="intake-logistics-refused-title"
              title="Pièce non conforme — refus logistique"
              className="w-full"
            />
          )}
          <p className={cn(segnaDialogBodyClass(), "w-full max-w-none")}>
            La pièce ne correspond pas à l&apos;annonce ou aux critères après réception. Un retour peut être mis en
            place (frais à ta charge sauf indication contraire). Consulte la page dédiée pour le motif et les prochaines
            étapes.
          </p>
          {note ? (
            <p className={cn(segnaDialogBodyClass(), "w-full max-w-none")}>
              <span className="font-semibold text-zinc-900">Motif : </span>
              {note}
            </p>
          ) : null}
          <Link
            href={`/items/${itemId}/refus-logistique`}
            className="flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 px-5 text-[13px] font-semibold text-white shadow-sm"
          >
            Page refus &amp; suite à donner
          </Link>
        </div>
      </div>
    );
  }

  if (showFulfillment) {
    const shippingTitle = fulfillmentIsShipping ? "Expédition en cours" : "Préparer ton envoi";
    const shippingBody = fulfillmentIsShipping
      ? memberIntakeInTransitShippingBody(shippingGroupTitles)
      : "Retrouve le bordereau et le suivi sur la page dédiée.";

    return (
      <div
        role="region"
        aria-labelledby="intake-shipping-title"
        className={cn(
          montserrat.className,
          "relative mx-auto flex w-full max-w-[460px] flex-col gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm",
        )}
      >
        {onStackDismiss ? <SegnaDialogDismissButton onClick={onStackDismiss} /> : null}
        <div className="flex w-full min-w-0 flex-col gap-3">
          {onStackDismiss ? (
            <div className="pr-10">
              <SegnaDialogTitleRow id="intake-shipping-title" title={shippingTitle} className="w-full" />
            </div>
          ) : (
            <SegnaDialogTitleRow id="intake-shipping-title" title={shippingTitle} className="w-full" />
          )}
          <p className={cn(segnaDialogBodyClass(), "w-full max-w-none")}>{shippingBody}</p>
          <Link
            href={buildShippingPageHref(itemId, intakeMetadata, shippingGroupIds)}
            className="flex h-11 w-full min-w-0 items-center justify-center rounded-full bg-zinc-900 px-4 text-[14px] font-semibold text-white"
          >
            {shipItemLabel}
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
