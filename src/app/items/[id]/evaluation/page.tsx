"use client";

import Link from "next/link";
import { Montserrat, Playfair_Display } from "next/font/google";
import { ChevronLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ItemIntakePanel, needsItemIntakeUi } from "@/components/item/ItemIntakePanel";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

function intakeUsesFloatingCard(listingStage: string | null | undefined) {
  return listingStage === "validation_pending";
}

const montserrat = Montserrat({ subsets: ["latin"], weight: ["600"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["700"] });

type IntakeSnap = {
  listing_stage: string | null;
  fulfillment_stage: string | null;
  metadata: unknown;
  updated_at: string | null;
};

/**
 * Analyse IA & commentaires (contenu détaillé à brancher). Bandeau intake fixe sous le header : offre + refus / acceptation si validation_pending.
 */
export default function ItemEvaluationAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = typeof params.id === "string" ? params.id : null;

  const [title, setTitle] = useState<string>("Analyse");
  const [pricePoints, setPricePoints] = useState<number | null>(null);
  const [intake, setIntake] = useState<IntakeSnap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const headerRef = useRef<HTMLElement | null>(null);
  const intakeStripRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(80);
  const [measuredIntakeStripHeight, setMeasuredIntakeStripHeight] = useState(0);

  // Le bandeau "pop-up" ne doit exister ici que pour la validation de l'offre.
  const showIntakeStrip = Boolean(intake && intake.listing_stage === "validation_pending");
  const intakeStripHeight = showIntakeStrip ? measuredIntakeStripHeight : 0;

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
    setTitle(typeof r.title === "string" && r.title.trim() ? r.title.trim() : "Analyse");
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

  /* eslint-disable react-hooks/set-state-in-effect -- chargement données Supabase au montage */
  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title, isLoading, errorMessage]);

  useLayoutEffect(() => {
    if (!showIntakeStrip) return;
    const el = intakeStripRef.current;
    if (!el) return;
    const measure = () => setMeasuredIntakeStripHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showIntakeStrip, intake?.listing_stage, intake?.fulfillment_stage]);

  if (!itemId) {
    return (
      <main className="min-h-[100dvh] bg-white p-6">
        <p className="text-sm text-zinc-500">Identifiant invalide.</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <header
          ref={headerRef}
          className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-5"
        >
          <div className="relative mx-auto flex max-w-[460px] min-h-[40px] items-center justify-center">
            <div className="h-5 w-40 animate-pulse rounded bg-zinc-200" />
          </div>
        </header>
        <div className="mx-auto max-w-[460px] px-6 py-12" style={{ paddingTop: headerHeight }}>
          <p className="text-sm text-zinc-500">Chargement...</p>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <header
          ref={headerRef}
          className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-5"
        >
          <div className="relative mx-auto flex max-w-[460px] items-center justify-center">
            <button
              type="button"
              onClick={() => router.back()}
              className="absolute left-0 top-1/2 -translate-y-1/2 p-1"
              aria-label="Retour"
            >
              <ChevronLeft className="h-6 w-6 text-zinc-700" />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[460px] px-6 py-12" style={{ paddingTop: headerHeight }}>
          <p className="text-sm text-[#E44D3E]">{errorMessage}</p>
          <Link
            href="/exchange"
            className={cn(montserrat.className, "mt-4 inline-block font-semibold text-[#5E3023]")}
          >
            Retour à l&apos;échange
          </Link>
        </div>
      </main>
    );
  }

  const ls = intake?.listing_stage;
  const canRenderPanel = ls && intake;

  return (
    <main className="min-h-[100dvh] bg-white">
      <header
        ref={headerRef}
        className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-5"
      >
        <div className="relative mx-auto flex max-w-[460px] items-center justify-center">
          <button
            type="button"
            onClick={() => router.back()}
            className="absolute left-0 top-1/2 -translate-y-1/2 p-1"
            aria-label="Retour"
          >
            <ChevronLeft className="h-6 w-6 text-zinc-700" />
          </button>
          <h1 className={cn(playfair.className, "mx-10 text-center text-[20px] text-zinc-900")}>{title}</h1>
        </div>
      </header>

      {showIntakeStrip && canRenderPanel ? (
        <div
          ref={intakeStripRef}
          className={cn(
            "fixed left-0 right-0 z-[50]",
            intakeUsesFloatingCard(ls)
              ? "bg-transparent pt-2.5"
              : "border-b border-zinc-200 bg-white shadow-[0_4px_14px_-4px_rgba(0,0,0,0.12)]",
          )}
          style={{ top: headerHeight }}
        >
          {intakeUsesFloatingCard(ls) ? (
            <div className="mx-4 max-w-[460px] sm:mx-auto">
              <ItemIntakePanel
                key={`${ls}-${intake.fulfillment_stage ?? ""}`}
                itemId={itemId}
                listingStage={ls}
                fulfillmentStage={intake.fulfillment_stage}
                intakeMetadata={intake.metadata}
                intakeUpdatedAt={intake.updated_at}
                offerPricePoints={pricePoints}
                placement="evaluation"
                onPipelineUpdated={() => void fetchData()}
              />
            </div>
          ) : (
            <ItemIntakePanel
              key={`${ls}-${intake.fulfillment_stage ?? ""}`}
              itemId={itemId}
              listingStage={ls}
              fulfillmentStage={intake.fulfillment_stage}
              intakeMetadata={intake.metadata}
              intakeUpdatedAt={intake.updated_at}
              offerPricePoints={pricePoints}
              placement="evaluation"
              onPipelineUpdated={() => void fetchData()}
            />
          )}
        </div>
      ) : null}

      <div
        className="relative z-0 mx-auto max-w-[460px] px-6 pb-12"
        style={{ paddingTop: headerHeight + intakeStripHeight }}
      >
        <p
          className={cn(
            montserrat.className,
            "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500",
          )}
        >
          Évaluation Segna
        </p>
        <p className={cn(montserrat.className, "mt-4 text-[15px] leading-relaxed text-zinc-600")}>
          Cette page affichera bientôt le compte rendu détaillé de l&apos;analyse (IA, critères, commentaires
          opérationnels).
        </p>
      </div>
    </main>
  );
}
