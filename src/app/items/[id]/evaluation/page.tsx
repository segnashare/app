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
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { readIntakeAiEvaluationSummary } from "@/lib/items/intake-metadata";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type IntakeSnap = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
  updated_at: string | null;
};

export default function ItemEvaluationAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = typeof params.id === "string" ? params.id : null;

  const [title, setTitle] = useState<string>("");
  const [pricePoints, setPricePoints] = useState<number | null>(null);
  const [intake, setIntake] = useState<IntakeSnap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [refuseHold, setRefuseHold] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefusing, setIsRefusing] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

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
      .select("title,price_points, item_intake(listing_stage,fulfillment_stage,metadata)")
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
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setRefuseHold(false);
    setActionError(null);
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
    await fetchData();
    router.push(`/items/${itemId}`);
  }, [itemId, router, fetchData]);

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
    router.push("/exchange");
  }, [itemId, router]);

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
    const errHeading = title.trim() ? `Evaluation ${title.trim()}` : "Evaluation";
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
  const proposedPtsRounded =
    pricePoints != null && Number.isFinite(Number(pricePoints)) ? Math.round(Number(pricePoints)) : null;
  const showMemberProposalPending =
    ls === "validation_pending" && proposedPtsRounded != null && proposedPtsRounded > 0;

  const bottomPad = showMemberProposalPending ? (refuseHold ? "pb-[13rem]" : "pb-[7.25rem]") : "pb-10";

  const hasHeatData =
    !!evaluationSummary &&
    (evaluationSummary.suggested_range?.low != null ||
      evaluationSummary.suggested_range?.median != null ||
      evaluationSummary.suggested_range?.high != null ||
      evaluationSummary.segna_offer != null ||
      (showMemberProposalPending && proposedPtsRounded != null));

  const hasAnalysisText =
    !!evaluationSummary && !!(evaluationSummary.positioning || evaluationSummary.rationale);

  const showAnalysisEmpty =
    !!evaluationSummary && !hasHeatData && !hasAnalysisText;

  const itemTitleForHeading = title.trim() ? title.trim() : null;
  const evaluationPageHeading = itemTitleForHeading ? `Evaluation ${itemTitleForHeading}` : "Evaluation";

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
        className={cn("relative z-0 flex flex-col space-y-[4.5px]", bottomPad)}
        style={{ paddingTop: headerHeight }}
      >
        {showMemberProposalPending ? (
          <section className="w-full bg-white px-5 pb-5 pt-0">
            <div className="space-y-3">
              <p
                className={cn(
                  segnaPlayfairDisplay.className,
                  "text-[2rem] font-medium leading-none tracking-tight text-zinc-900",
                )}
              >
                {proposedPtsRounded}{" "}
                <span className="text-[1.15rem] font-semibold text-zinc-500">pts</span>
              </p>
              <p className="text-[14px] leading-relaxed text-zinc-600">
                Segna te propose cette valorisation pour l&apos;entrée au catalogue.
              </p>
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
                  segnaOffer={evaluationSummary.segna_offer}
                  proposedPoints={showMemberProposalPending ? proposedPtsRounded : null}
                />
              ) : null}
              {evaluationSummary?.positioning ? (
                <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-[13px] text-zinc-700">
                  <span className="font-semibold text-zinc-900">Positionnement : </span>
                  <span className="capitalize">{evaluationSummary.positioning}</span>
                </p>
              ) : null}
              {evaluationSummary?.rationale ? (
                <p className="text-[15px] leading-[1.65] text-zinc-700 whitespace-pre-line">
                  {evaluationSummary.rationale}
                </p>
              ) : null}
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
    </main>
  );
}
