"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IntakeShippingBoard } from "@/components/shipping/IntakeShippingBoard";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import type { IntakeGroupSnapshot } from "@/lib/items/member-intake-groups.shared";
import { fetchShippingPageGroups } from "@/lib/items/shipping-page-fetch.shared";
import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

type GateState = "checking" | "ok" | "reject";

export function OuttakeShippingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightTransferId = searchParams.get("envoi")?.trim() || null;

  const [gate, setGate] = useState<GateState>("checking");
  const [groups, setGroups] = useState<IntakeGroupSnapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const applyLoadResult = useCallback((result: Awaited<ReturnType<typeof fetchShippingPageGroups>>) => {
    if (result.status === "ok") {
      setGroups(result.groups);
      setGate("ok");
      return;
    }
    setGate("reject");
    setLoadError(result.error);
  }, []);

  const loadShipping = useCallback(
    async (options?: { force?: boolean }) => {
      const generation = ++loadGenerationRef.current;
      setLoadError(null);
      if (options?.force) {
        setGate("checking");
      }
      const result = await fetchShippingPageGroups("outtake", options);
      if (generation !== loadGenerationRef.current) return;
      applyLoadResult(result);
    },
    [applyLoadResult],
  );

  useEffect(() => {
    void loadShipping();
  }, [loadShipping]);

  useEffect(() => {
    if (gate !== "reject" || loadError) return;
    router.replace("/exchange");
  }, [gate, loadError, router]);

  const pageTitle = useMemo(() => {
    if (groups.length > 1) return "Tes retours Segna";
    return "Prépare ton retour";
  }, [groups]);

  const pageSubtitle = useMemo(() => {
    const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
    if (groups.length > 1) {
      return `${totalItems} pièce${totalItems > 1 ? "s" : ""} à récupérer. Colis séparés, sans mutualisation.`;
    }
    if (totalItems <= 1) return "Choisis ton point relais et génère le bordereau de retour.";
    return `${totalItems} pièces dans ce colis retour.`;
  }, [groups]);

  if (gate === "reject" && loadError) {
    return (
      <div className="flex min-h-[100dvh] w-full flex-col bg-white px-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
        <button
          type="button"
          onClick={() => router.push("/exchange")}
          className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
          aria-label="Retour"
        >
          <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
        </button>
        <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Prépare ton retour</h1>
        <p className={cn(montserrat.className, "mt-3 text-[17px] font-medium leading-snug text-rose-600")}>
          {loadError}
        </p>
      </div>
    );
  }

  if (gate !== "ok") {
    return <AppPageLoading label="Chargement de ton retour" />;
  }

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-white">
      <header className="fixed left-1/2 top-0 z-[60] w-full max-w-[430px] -translate-x-1/2 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => router.push("/exchange")}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <span className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{pageTitle}</h1>
          <p className={cn(montserrat.className, "mt-1.5 text-[17px] font-medium leading-snug text-zinc-600")}>
            {pageSubtitle}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[430px] shrink-0 bg-white pt-[180px]" aria-hidden />

      <div className="mx-auto w-full max-w-[430px] flex-1 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
        <IntakeShippingBoard
          initialGroups={groups}
          highlightIntakeId={highlightTransferId}
          backHref="/exchange"
          logisticsMode="outtake"
        />
      </div>
    </div>
  );
}
