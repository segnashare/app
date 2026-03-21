"use client";

import { Montserrat } from "next/font/google";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

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
          montserrat.className,
          "text-[16px] font-semibold text-zinc-900",
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
