"use client";

import { CircleDollarSign, Clock } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const playfair = segnaPlayfairDisplay;

const EVALUATION_PIPELINE_STAGES = new Set(["evaluation", "evaluated"]);

type PipelineItem = {
  id: string;
  title: string;
  listingStage: "evaluation" | "evaluated" | "validation_pending";
};

function pipelineStageLabel(stage: PipelineItem["listingStage"]): string {
  if (stage === "evaluation") return "En évaluation";
  if (stage === "evaluated") return "Évaluée";
  return "Prix à confirmer";
}

function PendingGroupItemChip({
  title,
  statusLabel,
  quickAction,
}: {
  title: string;
  statusLabel: string;
  quickAction?: ReactNode;
}) {
  return (
    <div
      className={cn(
        montserrat.className,
        "flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-sm",
      )}
    >
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500"
        aria-hidden
      >
        <Clock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-zinc-900">{title}</span>
        <span className="block text-[12px] font-medium text-zinc-500">{statusLabel}</span>
      </div>
      {quickAction ? <div className="relative z-30 shrink-0">{quickAction}</div> : null}
    </div>
  );
}

type IntakeShippingGroupOthersSectionProps = {
  boardItemIds: string[];
};

export function IntakeShippingGroupOthersSection({ boardItemIds }: IntakeShippingGroupOthersSectionProps) {
  const [pipelineItems, setPipelineItems] = useState<PipelineItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  const boardItemIdSet = useMemo(
    () => new Set(boardItemIds.map((id) => id.trim()).filter(Boolean)),
    [boardItemIds],
  );

  const loadPipelineItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
      const supabase = createSupabaseBrowserClient() as any;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setPipelineItems([]);
        return;
      }

      const { data: rows } = await supabase
        .from("items")
        .select("id, title, item_intake(listing_stage)")
        .eq("owner_user_id", user.id)
        .is("deleted_at", null)
        .limit(100);

      const items: PipelineItem[] = [];
      for (const row of rows ?? []) {
        const id = String((row as { id?: string }).id ?? "").trim();
        if (!id || boardItemIdSet.has(id)) continue;
        const emb = (row as { item_intake?: unknown }).item_intake;
        const intake = Array.isArray(emb) ? emb[0] : emb;
        const ls =
          intake && typeof intake === "object"
            ? String((intake as { listing_stage?: string }).listing_stage ?? "").toLowerCase()
            : "";
        if (!EVALUATION_PIPELINE_STAGES.has(ls) && ls !== "validation_pending") continue;

        const title =
          typeof (row as { title?: string }).title === "string" &&
          (row as { title: string }).title.trim()
            ? (row as { title: string }).title.trim()
            : "Pièce";

        items.push({
          id,
          title,
          listingStage: ls as PipelineItem["listingStage"],
        });
      }
      items.sort((a, b) => a.title.localeCompare(b.title, "fr"));
      setPipelineItems(items);
    } catch {
      setPipelineItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [boardItemIdSet]);

  useEffect(() => {
    void loadPipelineItems();
  }, [loadPipelineItems]);

  const evaluationItems = useMemo(
    () => pipelineItems.filter((item) => EVALUATION_PIPELINE_STAGES.has(item.listingStage)),
    [pipelineItems],
  );
  const validationItems = useMemo(
    () => pipelineItems.filter((item) => item.listingStage === "validation_pending"),
    [pipelineItems],
  );
  const groupedPipelineItems = useMemo(() => {
    const items = [...evaluationItems, ...validationItems];
    items.sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return items;
  }, [evaluationItems, validationItems]);

  const loading = itemsLoading;
  const showPipelineGroup = groupedPipelineItems.length > 0;
  const showNewPieceCta = true;
  const showSection = !loading && (showPipelineGroup || showNewPieceCta);

  if (!showSection) return null;

  const sectionHint =
    evaluationItems.length > 0 && (validationItems.length > 0 || showNewPieceCta)
      ? "Pièces en cours. Confirme les prix pour les regrouper."
      : evaluationItems.length > 0
        ? "Pièces en cours d'évaluation."
        : validationItems.length > 0 && showNewPieceCta
          ? "Confirme le prix ou propose une nouvelle pièce."
          : validationItems.length > 0
            ? "Confirme le prix proposé."
            : "Propose une nouvelle pièce à regrouper.";

  return (
    <section className="border-t border-zinc-200 bg-white px-5 pb-4 pt-8">
      <h2 className={cn(playfair.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
        Grouper d&apos;autres prêts
      </h2>
      <p className={cn(montserrat.className, "mt-2 text-[14px] font-medium leading-snug text-zinc-600")}>
        {sectionHint}
      </p>

      <div className={cn(montserrat.className, "mt-5 flex flex-col gap-2.5")}>
        {showPipelineGroup ? (
          <div className="space-y-3">
            <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-4">
              <div className="space-y-2">
                {groupedPipelineItems.map((item) => (
                  <PendingGroupItemChip
                    key={item.id}
                    title={item.title}
                    statusLabel={pipelineStageLabel(item.listingStage)}
                    quickAction={
                      item.listingStage === "validation_pending" ? (
                        <Link
                          href={`/items/${encodeURIComponent(item.id)}/evaluation`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700"
                          aria-label={`Confirmer le prix de ${item.title}`}
                        >
                          <CircleDollarSign className="h-5 w-5" aria-hidden />
                        </Link>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
            {evaluationItems.length > 0 ? (
              <p className="text-[13px] font-medium leading-snug text-zinc-500">
                Attends la fin de l&apos;évaluation avant un envoi groupé.
              </p>
            ) : null}
          </div>
        ) : null}

        {showNewPieceCta ? (
          <Link
            href="/items/new?fresh=1"
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
          >
            Nouvelle pièce
          </Link>
        ) : null}
      </div>
    </section>
  );
}
