"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type ExchangeProposePieceButtonProps = {
  guideExchangeOnboarding?: boolean;
};

export function ExchangeProposePieceButton({
  guideExchangeOnboarding = false,
}: ExchangeProposePieceButtonProps) {
  const buttonClassName = cn(
    "segna-guidance-shimmer-target inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900",
    guideExchangeOnboarding && "segna-guidance-shimmer-active",
  );

  return (
    <Link href="/items/new?fresh=1" className={buttonClassName}>
      <Plus className="h-4 w-4" strokeWidth={2.5} />
      Proposer une pièce
    </Link>
  );
}
