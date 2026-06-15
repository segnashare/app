"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IntakeShippingBoard } from "@/components/shipping/IntakeShippingBoard";
import { MemberIntakeTransferDepositConfirmModal } from "@/components/shipping/MemberIntakeTransferDepositConfirmModal";
import type { IntakeGroupSnapshot } from "@/lib/items/member-intake-groups.shared";
import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

type GateState = "checking" | "ok" | "reject";

export function ShippingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightIntakeId = searchParams.get("envoi")?.trim() || null;
  const legacyIds = searchParams.get("ids")?.trim() ?? "";

  const [gate, setGate] = useState<GateState>("checking");
  const [groups, setGroups] = useState<IntakeGroupSnapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const legacyRedirectDone = useRef(false);

  const loadShipping = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/intakes/shipping", { headers: { Accept: "application/json" } });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        groups?: IntakeGroupSnapshot[];
        error?: string;
      };
      if (!data.ok || !data.groups) {
        setGate("reject");
        setLoadError(data.error ?? null);
        return;
      }
      if (data.groups.length === 0) {
        setGate("reject");
        return;
      }
      setGroups(data.groups);
      setGate("ok");
    } catch {
      setGate("reject");
      setLoadError("Impossible de charger tes envois.");
    }
  }, []);

  useEffect(() => {
    void loadShipping();
  }, [loadShipping]);

  useEffect(() => {
    if (gate !== "ok" || !legacyIds || legacyRedirectDone.current) return;
    legacyRedirectDone.current = true;
    if (!searchParams.has("ids")) return;
    const next = highlightIntakeId
      ? `/items/shipping?envoi=${encodeURIComponent(highlightIntakeId)}`
      : "/items/shipping";
    router.replace(next);
  }, [gate, highlightIntakeId, legacyIds, router, searchParams]);

  useEffect(() => {
    if (gate !== "reject" || loadError) return;
    router.replace("/exchange");
  }, [gate, loadError, router]);

  const pageTitle = useMemo(() => {
    if (groups.length > 1) return "Tes envois vers Segna";
    return "Prépare ton envoi";
  }, [groups]);

  const pageSubtitle = useMemo(() => {
    const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
    if (groups.length > 1) {
      return `${totalItems} pièce${totalItems > 1 ? "s" : ""} à envoyer à Segna.`;
    }
    if (totalItems <= 1) return "Génère ton bordereau et envoie ta pièce à Segna.";
    return `${totalItems} pièces dans ce colis.`;
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
        <h1 className={cn("mt-5", playfair.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Prépare ton envoi</h1>
        <p className={cn(montserrat.className, "mt-3 text-[17px] font-medium leading-snug text-rose-600")}>
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => {
            setGate("checking");
            void loadShipping();
          }}
          className={cn(
            montserrat.className,
            "mt-6 inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-6 text-[15px] font-semibold text-white",
          )}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (gate !== "ok") {
    return <div className="min-h-[100dvh] bg-white" aria-busy="true" />;
  }

  return (
    <>
      <MemberIntakeTransferDepositConfirmModal />
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
            {loadError ? (
              <p className={cn(montserrat.className, "mt-2 text-[13px] font-medium text-rose-600")}>{loadError}</p>
            ) : null}
          </div>
        </header>

        <div className="mx-auto w-full max-w-[430px] shrink-0 bg-white pt-[180px]" aria-hidden />

        <div className="mx-auto w-full max-w-[430px] flex-1 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
          <IntakeShippingBoard
            initialGroups={groups}
            highlightIntakeId={highlightIntakeId}
            backHref="/exchange"
          />
        </div>
      </div>
    </>
  );
}
