"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";

const montserrat = segnaMontserrat;

import { EvaluationPriceHeatStrip } from "@/components/item/EvaluationPriceHeatStrip";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import {
  SEGNA_DIALOG_SHEET_CLASS,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import {
  readIntakeAiPriceRevaluation,
  readIntakeAiEvaluationSummary,
  type IntakeAiEvaluationSummary,
  type IntakeEvaluationExampleItem,
} from "@/lib/items/intake-metadata";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { acknowledgeIntakeStageForSession } from "@/lib/items/intake-session-ack";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type IntakeSnap = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
  updated_at: string | null;
};

const EXAMPLE_GROUP_LABELS: Record<string, string> = {
  q1: "Fourchette basse",
  median: "Prix médian",
  q3: "Fourchette haute",
};

function formatExamplePrice(item: IntakeEvaluationExampleItem): string | null {
  if (item.price == null || !Number.isFinite(item.price)) return null;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: item.currency || "EUR",
      maximumFractionDigits: Number.isInteger(item.price) ? 0 : 2,
    }).format(item.price);
  } catch {
    return `${item.price} ${item.currency ?? "EUR"}`;
  }
}

function getExampleGroups(summary: IntakeAiEvaluationSummary | null) {
  if (!summary) return [];
  const source = summary.example_items;
  if (source && Object.keys(source).length > 0) {
    const orderedKeys = [
      ...["q1", "median", "q3"].filter((key) => Array.isArray(source[key]) && source[key].length > 0),
      ...Object.keys(source).filter((key) => !["q1", "median", "q3"].includes(key)),
    ];
    return orderedKeys.map((key) => ({
      key,
      label: EXAMPLE_GROUP_LABELS[key] ?? key,
      items: source[key],
    }));
  }
  if (summary.comparison_items?.length) {
    return [{ key: "comparison_items", label: "Comparables", items: summary.comparison_items }];
  }
  return [];
}

function EvaluationExampleCard({ item }: { item: IntakeEvaluationExampleItem }) {
  const price = formatExamplePrice(item);
  const meta = [item.brand, item.size ? `T. ${item.size}` : null, item.condition].filter(Boolean).join(" · ");
  const content = (
    <>
      {item.preview_image ? (
        <ImageCoverWithSkeleton
          src={item.preview_image}
          alt={item.title ? `Aperçu ${item.title}` : "Aperçu item comparable"}
          className="aspect-[4/5] w-full rounded-xl"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[4/5] w-full items-center justify-center rounded-xl bg-zinc-100 px-3 text-center text-[12px] font-semibold text-zinc-400">
          Pas d&apos;image
        </div>
      )}
      <div className="mt-2 min-w-0 space-y-1">
        {price ? <p className="text-[14px] font-bold leading-tight text-zinc-950">{price}</p> : null}
        <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-800">
          {item.title || "Item comparable"}
        </p>
        {meta ? <p className="line-clamp-2 text-[11px] font-medium leading-snug text-zinc-500">{meta}</p> : null}
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
          {item.country ? <span>{item.country}</span> : null}
          {item.favouriteCount != null ? <span>{item.favouriteCount} favoris</span> : null}
        </p>
      </div>
    </>
  );

  const className = "block w-[132px] shrink-0 rounded-2xl border border-zinc-100 bg-white p-2 shadow-sm";
  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function ItemEvaluationAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = typeof params.id === "string" ? params.id : null;

  const [title, setTitle] = useState<string>("");
  const [pricePoints, setPricePoints] = useState<number | null>(null);
  const [replacementValuePoints, setReplacementValuePoints] = useState<number | null>(null);
  const [intake, setIntake] = useState<IntakeSnap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [refuseHold, setRefuseHold] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefusing, setIsRefusing] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [valorisationExplainOpen, setValorisationExplainOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(80);

  const fetchData = useCallback(async () => {
    if (!itemId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setErrorMessage("Session invalide.");
      setIsLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from("items")
      .select("title,price_points,replacement_value_points, item_intake(listing_stage,fulfillment_stage,metadata)")
      .eq("id", itemId)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !row) {
      setErrorMessage("Pièce introuvable.");
      setIsLoading(false);
      return;
    }
    const r = row as Record<string, unknown>;
    setTitle(typeof r.title === "string" && r.title.trim() ? r.title.trim() : "");
    setPricePoints(r.price_points != null ? Number(r.price_points) : null);
    setReplacementValuePoints(
      r.replacement_value_points != null ? Number(r.replacement_value_points) : null,
    );
    const rawIntake = r.item_intake as unknown;
    const emb = Array.isArray(rawIntake) ? rawIntake[0] : rawIntake;
    if (emb && typeof emb === "object") {
      const o = emb as Record<string, unknown>;
      setIntake({
        listing_stage: typeof o.listing_stage === "string" ? o.listing_stage : null,
        fulfillment_stage: typeof o.fulfillment_stage === "string" ? o.fulfillment_stage : null,
        metadata: o.metadata ?? {},
        updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
      });
    } else {
      setIntake(null);
    }
    setIsLoading(false);
  }, [itemId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchData]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setRefuseHold(false);
      setActionError(null);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [itemId, intake?.listing_stage]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title, isLoading, errorMessage]);

  const handleAcceptOffer = useCallback(async () => {
    if (!itemId) return;
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
      surface: "evaluation_page",
    });
    if (intake?.listing_stage) {
      acknowledgeIntakeStageForSession(itemId, intake.listing_stage, intake.fulfillment_stage);
    }
    await fetchData();
    router.push(`/items/${itemId}`);
  }, [itemId, intake?.fulfillment_stage, intake?.listing_stage, router, fetchData]);

  const handleRefuseOffer = useCallback(async () => {
    if (!itemId) return;
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
    setRefuseHold(false);
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
    if (intake?.listing_stage) {
      acknowledgeIntakeStageForSession(itemId, intake.listing_stage, intake.fulfillment_stage);
    }
    router.push("/exchange");
  }, [intake?.fulfillment_stage, intake?.listing_stage, itemId, router]);

  if (!itemId) {
    return (
      <main className={cn(montserrat.className, "min-h-[100dvh] bg-zinc-100 p-6")}>
        <p className="text-sm text-zinc-500">Identifiant invalide.</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className={cn(montserrat.className, "min-h-[100dvh] bg-zinc-100")}>
        <header
          ref={headerRef}
          className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 bg-white"
        >
          <div className="flex w-full flex-col px-5 pb-4 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => router.back()}
                className="-ml-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-900"
                aria-label="Retour"
              >
                <ChevronLeft className="h-7 w-7 text-zinc-700" strokeWidth={2.25} />
              </button>
            </div>
            <SegnaSkeletonBlock className="mt-4 h-8 w-[min(100%,260px)]" rounded="rounded-lg" />
          </div>
        </header>
        <div
          className="relative z-0 flex flex-col space-y-[4.5px] pb-12"
          style={{ paddingTop: headerHeight }}
        >
          <div className="w-full bg-white px-5 py-4">
            <SegnaSkeletonBlock className="h-3 w-40" rounded="rounded-md" />
          </div>
          <div className="w-full bg-white px-5 py-4">
            <SegnaSkeletonBlock className="h-4 w-full max-w-full" rounded="rounded-md" />
          </div>
          <div className="w-full bg-white px-5 py-4">
            <SegnaSkeletonBlock className="h-4 w-full max-w-[95%]" rounded="rounded-md" />
          </div>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    const errHeading = title.trim() ? `Évaluation : ${title.trim()}` : "Évaluation";
    return (
      <main className={cn(montserrat.className, "min-h-[100dvh] bg-zinc-100")}>
        <header
          ref={headerRef}
          className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 bg-white"
        >
          <div className="flex w-full flex-col px-5 pb-4 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => router.back()}
                className="-ml-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-900"
                aria-label="Retour"
              >
                <ChevronLeft className="h-7 w-7 text-zinc-700" strokeWidth={2.25} />
              </button>
            </div>
            <h1 className={cn("mt-4", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              {errHeading}
            </h1>
          </div>
        </header>
        <div
          className="flex flex-col space-y-[4.5px] px-0 py-12"
          style={{ paddingTop: headerHeight }}
        >
          <div className="w-full bg-white px-5 py-5">
            <p className="text-sm text-[#E44D3E]">{errorMessage}</p>
            <Link
              href="/exchange"
              className={cn(montserrat.className, "mt-4 inline-block font-semibold text-[#5E3023]")}
            >
              Retour à l&apos;échange
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const ls = intake?.listing_stage;
  const evaluationSummary = readIntakeAiEvaluationSummary(intake?.metadata);
  const priceRevaluation = readIntakeAiPriceRevaluation(intake?.metadata);
  const hasPriceReview = priceRevaluation != null;
  const evaluationExampleGroups = getExampleGroups(evaluationSummary);
  const hasExampleGroups = evaluationExampleGroups.length > 0;
  const proposedPtsRounded =
    pricePoints != null && Number.isFinite(Number(pricePoints)) ? Math.round(Number(pricePoints)) : null;
  const replacementPtsRounded =
    replacementValuePoints != null && Number.isFinite(Number(replacementValuePoints))
      ? Math.round(Number(replacementValuePoints))
      : proposedPtsRounded;
  const showMemberProposalPending =
    ls === "validation_pending" && proposedPtsRounded != null && proposedPtsRounded > 0;
  const showCurrentValuations =
    !showMemberProposalPending &&
    proposedPtsRounded != null &&
    proposedPtsRounded > 0 &&
    ls === "validated";
  /** Padding bas : hors proposition en attente ; sinon réserve gérée par un bloc blanc (évite la bande grise zinc). */
  const contentBottomPadding = showMemberProposalPending ? "" : "pb-10";
  const footerOverlapSpacerClass =
    showMemberProposalPending && (refuseHold ? "min-h-[13rem]" : "min-h-[7.25rem]");

  const finalSegnaOffer = hasPriceReview
    ? (priceRevaluation.segna_offer ?? proposedPtsRounded ?? evaluationSummary?.segna_offer)
    : proposedPtsRounded != null && proposedPtsRounded > 0
      ? proposedPtsRounded
      : evaluationSummary?.segna_offer;
  const finalRationale = hasPriceReview ? priceRevaluation.rationale : evaluationSummary?.rationale;
  const finalPositioning =
    hasPriceReview && priceRevaluation?.positioning
      ? priceRevaluation.positioning
      : evaluationSummary?.positioning;

  const hasHeatData =
    !!evaluationSummary &&
    (evaluationSummary.suggested_range?.low != null ||
      evaluationSummary.suggested_range?.median != null ||
      evaluationSummary.suggested_range?.high != null ||
      finalSegnaOffer != null);

  const hasAnalysisText =
    !!evaluationSummary && !!(finalPositioning || finalRationale);

  const showAnalysisEmpty =
    !!evaluationSummary && !hasHeatData && !hasAnalysisText && !hasExampleGroups;

  const itemTitleForHeading = title.trim() ? title.trim() : null;
  const evaluationPageHeading = itemTitleForHeading ? `Évaluation : ${itemTitleForHeading}` : "Évaluation";

  const showAnalysisSectionBody =
    !!evaluationSummary && (hasHeatData || hasAnalysisText);
  const showEmptyAnalysisMessage = !evaluationSummary || showAnalysisEmpty;

  return (
    <main className={cn(montserrat.className, "relative flex min-h-[100dvh] flex-col bg-zinc-100")}>
      <header
        ref={headerRef}
        className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 bg-white"
      >
        <div className="flex w-full flex-col px-5 pb-4 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => router.back()}
              className="-ml-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
            >
              <ChevronLeft className="h-7 w-7 text-zinc-700" strokeWidth={2.25} />
            </button>
          </div>
          <h1 className={cn("mt-4", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {evaluationPageHeading}
          </h1>
        </div>
      </header>

      <div
        className={cn("relative z-0 flex flex-col space-y-[4.5px]", contentBottomPadding)}
        style={{ paddingTop: headerHeight }}
      >
        {showMemberProposalPending ? (
          <section className="w-full bg-white px-5 pb-5 pt-0">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Valeur d&apos;échange
                  </p>
                  <p className="mt-1 text-[1.75rem] font-semibold leading-none tracking-tight text-zinc-900">
                    {proposedPtsRounded}{" "}
                    <span className="text-[1rem] font-semibold text-zinc-500">pts</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Valeur de remplacement
                  </p>
                  <p className="mt-1 text-[1.75rem] font-semibold leading-none tracking-tight text-zinc-900">
                    {replacementPtsRounded}{" "}
                    <span className="text-[1rem] font-semibold text-zinc-500">pts</span>
                  </p>
                </div>
              </div>
              <p className="text-[14px] leading-relaxed text-zinc-600">
                Segna te propose cette valorisation pour l&apos;entrée au catalogue.{" "}
                <button
                  type="button"
                  onClick={() => setValorisationExplainOpen(true)}
                  className="font-semibold text-blue-600 underline decoration-blue-500/35 underline-offset-[0.18em] transition hover:text-blue-700 hover:decoration-blue-600/50"
                >
                  En savoir plus
                </button>
              </p>
            </div>
          </section>
        ) : null}

        {showCurrentValuations ? (
          <section className="w-full bg-white px-5 py-4">
            <h2 className={cn(segnaPlayfairDisplay.className, "text-[1.125rem] font-bold text-zinc-900")}>
              Tes valorisations
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Valeur d&apos;échange
                </p>
                <p className="mt-1 text-[1.5rem] font-semibold text-zinc-900">
                  {proposedPtsRounded} <span className="text-[0.95rem] text-zinc-500">pts</span>
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">Évolue avec la demande</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Valeur de remplacement
                </p>
                <p className="mt-1 text-[1.5rem] font-semibold text-zinc-900">
                  {replacementPtsRounded} <span className="text-[0.95rem] text-zinc-500">pts</span>
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">Base garantie Segna</p>
              </div>
            </div>
          </section>
        ) : null}

        {showAnalysisSectionBody ? (
          <SectionBlock
            title="Analyse IA"
            className="w-full bg-white px-5 py-4"
            titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
          >
            <div className="space-y-5">
              {hasHeatData && evaluationSummary ? (
                <EvaluationPriceHeatStrip
                  embedded
                  low={evaluationSummary.suggested_range?.low}
                  median={evaluationSummary.suggested_range?.median}
                  high={evaluationSummary.suggested_range?.high}
                  segnaOffer={finalSegnaOffer}
                />
              ) : null}
              {finalPositioning ? (
                <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-[13px] text-zinc-700">
                  <span className="font-semibold text-zinc-900">Positionnement : </span>
                  <span className="capitalize">{finalPositioning}</span>
                </p>
              ) : null}
              {finalRationale ? (
                <p className="text-[15px] leading-[1.65] text-zinc-700 whitespace-pre-line">
                  {finalRationale}
                </p>
              ) : null}
            </div>
          </SectionBlock>
        ) : null}

        {hasExampleGroups ? (
          <SectionBlock
            title="Exemples comparables"
            className="w-full bg-white px-5 py-4"
            titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
          >
            <div className="space-y-5">
              {evaluationExampleGroups.map((group) => (
                <div key={group.key} className="min-w-0">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 className="text-[14px] font-bold text-zinc-900">{group.label}</h3>
                    <span className="text-[11px] font-semibold text-zinc-400">{group.items.length} exemples</span>
                  </div>
                  <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {group.items.map((item, index) => (
                      <EvaluationExampleCard
                        key={`${group.key}-${item.id ?? item.url ?? index}`}
                        item={item}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionBlock>
        ) : null}

        {showEmptyAnalysisMessage ? (
          <SectionBlock
            title="Analyse IA"
            className="w-full bg-white px-5 py-8"
            titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
          >
            <p className="text-center text-[14px] leading-relaxed text-zinc-600">
              Aucune synthèse d&apos;analyse reçue pour le moment.
            </p>
          </SectionBlock>
        ) : null}

        {footerOverlapSpacerClass ? (
          <div
            className={cn("w-full shrink-0 bg-white -mt-[4.5px]", footerOverlapSpacerClass)}
            aria-hidden
          />
        ) : null}
      </div>

      {showMemberProposalPending ? (
        <footer
          className={cn(
            montserrat.className,
            "fixed bottom-0 left-0 right-0 z-[55] border-t border-zinc-200/90 bg-white/95 shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.12)] backdrop-blur-lg",
          )}
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-[460px] px-4 pt-3">
            {actionError ? (
              <p className="mb-2 text-center text-[12px] font-medium text-[#E44D3E]">{actionError}</p>
            ) : null}
            {refuseHold ? (
              <div className="space-y-3 pb-2">
                <p className="text-center text-[13px] leading-snug text-zinc-600">
                  Refuser retire ta fiche de la file d&apos;entrée. Tu pourras créer une nouvelle annonce plus tard.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isRefusing}
                    onClick={() => {
                      setRefuseHold(false);
                      setActionError(null);
                    }}
                    className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[14px] font-semibold text-zinc-800 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={isRefusing}
                    onClick={() => void handleRefuseOffer()}
                    className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-[#E44D3E] text-[14px] font-semibold text-white disabled:opacity-50"
                  >
                    {isRefusing ? "…" : "Confirmer le refus"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pb-2">
                <button
                  type="button"
                  disabled={isAccepting || isRefusing}
                  onClick={() => {
                    setActionError(null);
                    setRefuseHold(true);
                  }}
                  className="flex h-[3.25rem] flex-1 items-center justify-center rounded-2xl border-2 border-zinc-200 bg-white text-[14px] font-semibold text-zinc-800 disabled:opacity-50"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  disabled={isAccepting || isRefusing}
                  onClick={() => void handleAcceptOffer()}
                  className="flex h-[3.25rem] flex-[1.35] items-center justify-center rounded-2xl bg-zinc-900 text-[14px] font-semibold text-white shadow-md disabled:opacity-50"
                >
                  {isAccepting ? "…" : "Accepter"}
                </button>
              </div>
            )}
          </div>
        </footer>
      ) : null}

      {valorisationExplainOpen ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40"
          onClick={() => setValorisationExplainOpen(false)}
        >
          <div className={SEGNA_DIALOG_SHEET_CLASS} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h2 className={segnaDialogTitleClass()}>À quoi correspond cette évaluation ?</h2>

            <h3 className={cn(montserrat.className, "mt-5 text-[15px] font-bold leading-snug text-zinc-900")}>
              Deux valeurs pour ta pièce
            </h3>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Cette évaluation se compose de{" "}
              <strong className="font-semibold text-zinc-900">deux éléments</strong>&nbsp;:
            </p>
            <ul className={cn(segnaDialogBodyClass(), "mt-2 list-disc space-y-2 pl-5")}>
              <li>
                <strong className="font-semibold text-zinc-900">la valeur de remplacement</strong>, qui sert de
                base à la <strong className="font-semibold text-zinc-900">garantie Segna</strong> en cas de perte ou
                de dommage important sur ta pièce&nbsp;;
              </li>
              <li>
                <strong className="font-semibold text-zinc-900">la valeur d&apos;échange</strong>,
                exprimée en <strong className="font-semibold text-zinc-900">points</strong>, qui correspond à ce que
                ta pièce &quot;vaut&quot; dans le{" "}
                <strong className="font-semibold text-zinc-900">catalogue</strong> pour calculer ta capacité à
                emprunter d&apos;autres articles.
              </li>
            </ul>

            <h3 className={cn(montserrat.className, "mt-5 text-[15px] font-bold leading-snug text-zinc-900")}>
              Une garantie en cas de problème
            </h3>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              <strong className="font-semibold text-zinc-900">La valeur de remplacement</strong> est une{" "}
              <strong className="font-semibold text-zinc-900">référence stable</strong>&nbsp;: si ta pièce est{" "}
              <strong className="font-semibold text-zinc-900">perdue</strong> ou{" "}
              <strong className="font-semibold text-zinc-900">déclarée irréparable</strong>, Segna s&apos;appuie sur
              cette estimation pour te proposer une{" "}
              <strong className="font-semibold text-zinc-900">compensation</strong> selon les{" "}
              <a
                href="https://www.segnashare.com/conditions-location"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 underline decoration-blue-500/40 underline-offset-2 transition hover:text-blue-700"
              >
                conditions générales de location
              </a>
              , afin que tu ne sois pas lésée.
            </p>

            <h3 className={cn(montserrat.className, "mt-5 text-[15px] font-bold leading-snug text-zinc-900")}>
              Une valeur d&apos;échange qui vit avec le dressing
            </h3>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              <strong className="font-semibold text-zinc-900">La valeur d&apos;échange</strong> peut
              ensuite <strong className="font-semibold text-zinc-900">évoluer dans le temps</strong> en fonction de la
              demande pour ta pièce, de la saison ou de l&apos;évolution de son état, pour refléter au mieux sa place
              réelle dans le <strong className="font-semibold text-zinc-900">dressing partagé</strong>.
            </p>

            <button
              type="button"
              onClick={() => setValorisationExplainOpen(false)}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
