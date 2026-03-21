import Link from "next/link";

import { Plus } from "lucide-react";

type ExchangeAddPieceOverlayButtonProps = {
  canAddMoreLends?: boolean;
};

export function ExchangeAddPieceOverlayButton({ canAddMoreLends = true }: ExchangeAddPieceOverlayButtonProps) {
  if (!canAddMoreLends) return null;

  return (
    <Link
      href="/items/new?fresh=1"
      aria-label="Ajouter une piece au pret"
      className="fixed bottom-24 left-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_12px_26px_rgba(0,0,0,0.22)] transition hover:bg-zinc-800 md:left-1/2 md:-translate-x-[199px]"
    >
      <Plus className="h-5 w-5" />
    </Link>
  );
}
