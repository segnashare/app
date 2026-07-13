"use client";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type ItemAddToCartCtaProps = {
  inCart?: boolean;
  busy?: boolean;
  onClick?: () => void;
  className?: string;
};

export function ItemAddToCartCta({ inCart = false, busy = false, onClick, className }: ItemAddToCartCtaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        montserrat.className,
        "flex h-12 w-full items-center justify-center rounded-xl px-4 text-[13px] font-bold uppercase tracking-[0.06em] transition active:scale-[0.99] disabled:opacity-50",
        inCart
          ? "border border-zinc-950 bg-white text-zinc-950"
          : "bg-zinc-950 text-white",
        className,
      )}
    >
      Ajouter au panier
    </button>
  );
}
