"use client";

import { Montserrat, Playfair_Display } from "next/font/google";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["800"] });

export type InsightCardData = {
  prompt: string;
  response: string;
};

type InsightCardProps = {
  data: InsightCardData;
  className?: string;
};

export function InsightCard({ data, className }: InsightCardProps) {
  const hasPrompt = data.prompt.trim().length > 0;
  const hasResponse = data.response.trim().length > 0;

  if (!hasPrompt && !hasResponse) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "py-[65px] pl-[50px] pr-[70px]",
        className,
      )}
    >
      {hasPrompt ? (
        <p
          className={cn(
            montserrat.className,
            "text-[16px] font-semibold text-zinc-900",
          )}
        >
          {data.prompt.trim()}
        </p>
      ) : null}
      <p
        className={cn(
          playfairDisplay.className,
          "text-[28px] font-extrabold leading-snug text-zinc-900",
          hasPrompt && "mt-2",
        )}
      >
        {hasResponse ? data.response.trim() : "—"}
      </p>
    </div>
  );
}
