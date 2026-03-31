"use client";

import { BadgeCheck, Package } from "lucide-react";
import { Montserrat, Playfair_Display } from "next/font/google";

import { formatItemSizeLabel } from "@/lib/items/formatItemSizeLabel";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["800"] });

const SEGNA_ICON_PATH = "/ressources/icons/segna.svg";

export type ItemSegnaDetentionSectionProps = {
  /** Points affichés comme sur la fiche info (mods Segna). */
  pricePoints: number | null;
  /** Libellé taille brut (ex. « M »), comme `ItemInfoCardData.size`. */
  sizeLabel: string;
  className?: string;
};

/**
 * Carte propriétaire pour le stock Segna (compte `corporate_inventory`) : pas un profil membre.
 */
export function ItemSegnaDetentionSection({ pricePoints, sizeLabel, className }: ItemSegnaDetentionSectionProps) {
  const hasSize = Boolean(sizeLabel && sizeLabel !== "-");
  const priceText = pricePoints != null ? String(pricePoints) : "—";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <h3 className={cn(playfairDisplay.className, "text-[24px] font-extrabold tracking-tight text-zinc-900")}>
          Détention Segna
        </h3>
        <BadgeCheck size={22} aria-label="Stock Segna certifié" className="shrink-0 text-[#3B82F6]" />
      </div>
      <p className={cn(montserrat.className, "mt-1 flex flex-wrap items-center gap-x-1 text-[13px] text-zinc-500")}>
        <Package className="inline h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden strokeWidth={2.2} />
        <span aria-hidden className="text-zinc-400">
          {" "}
          •{" "}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-zinc-700">
          {priceText}
          <img src={SEGNA_ICON_PATH} alt="" className="h-4 w-4 shrink-0" aria-hidden />
        </span>
        {hasSize ? (
          <>
            <span aria-hidden className="text-zinc-400">
              {" "}
              •{" "}
            </span>
            <span className="font-semibold text-zinc-700">{formatItemSizeLabel(sizeLabel)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
