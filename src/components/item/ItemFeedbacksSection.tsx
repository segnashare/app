"use client";

import { Star } from "lucide-react";

import type { ItemFeedbackDisplayRow } from "@/lib/feedback/item-feedback-types";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

function formatFeedbackDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

type ItemFeedbacksSectionProps = {
  feedbacks: ItemFeedbackDisplayRow[];
  className?: string;
};

export function ItemFeedbacksSection({ feedbacks, className }: ItemFeedbacksSectionProps) {
  if (feedbacks.length === 0) return null;

  return (
    <section className={cn("space-y-3", className)}>
      <h2 className={cn(montserrat.className, "text-[16px] font-semibold text-zinc-500")}>Avis</h2>
      <ul className="space-y-3">
        {feedbacks.map((fb) => (
          <li key={fb.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-900")}>
                {fb.reviewerDisplayName}
              </p>
              <div className="flex shrink-0 items-center gap-0.5" aria-label={`${fb.rating} sur 5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      "h-4 w-4",
                      i < fb.rating ? "fill-zinc-900 text-zinc-900" : "text-zinc-300",
                    )}
                    strokeWidth={1.75}
                  />
                ))}
              </div>
            </div>
            {fb.comment ? (
              <p className={cn(montserrat.className, "mt-2 text-[15px] leading-relaxed text-zinc-700")}>{fb.comment}</p>
            ) : null}
            {fb.createdAt ? (
              <p className={cn(montserrat.className, "mt-2 text-[12px] text-zinc-400")}>
                {formatFeedbackDate(fb.createdAt)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
