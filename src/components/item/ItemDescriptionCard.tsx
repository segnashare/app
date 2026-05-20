"use client";

import { cn } from "@/lib/utils/cn";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;




type ItemDescriptionCardProps = {
  description: string;
  className?: string;
};

export function ItemDescriptionCard({ description, className }: ItemDescriptionCardProps) {
  const trimmed = description.trim();

  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "py-[40px] pl-[50px] pr-[60px]",
        className,
      )}
    >
      <p
        className={cn(
          playfairDisplay.className,
          "text-[28px] font-extrabold leading-snug text-zinc-900",
        )}
      >
        Description
      </p>
      <p
        className={cn(
          montserrat.className,
          "mt-2 text-[16px] font-semibold leading-snug text-zinc-900",
        )}
      >
        {trimmed ? trimmed : "—"}
      </p>
    </div>
  );
}
