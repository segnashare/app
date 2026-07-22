"use client";

import { Package, Repeat2, Star, Tag } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { ItemWeeklyRentalPriceDisplay } from "@/components/ui/ItemWeeklyRentalPriceDisplay";
import { formatItemSizeLabel } from "@/lib/items/formatItemSizeLabel";
import { cn } from "@/lib/utils/cn";

const COLOR_LABEL_TO_HEX: Record<string, string> = {
  noir: "#000000",
  blanc: "#ffffff",
  gris: "#808080",
  "gris-clair": "#d3d3d3",
  "gris-fonce": "#4a4a4a",
  beige: "#f5f5dc",
  bleu: "#2563eb",
  "bleu-marine": "#000080",
  "bleu-clair": "#add8e6",
  "bleu-nuit": "#191970",
  rouge: "#dc2626",
  rose: "#f472b6",
  "rose-clair": "#fce7f3",
  vert: "#16a34a",
  "vert-clair": "#86efac",
  "vert-olive": "#84cc16",
  jaune: "#eab308",
  orange: "#ea580c",
  marron: "#92400e",
  "marron-clair": "#a16207",
  bordeaux: "#722f37",
  violet: "#7c3aed",
  "violet-clair": "#c4b5fd",
  camel: "#c19a6b",
  ecru: "#f5f5dc",
  nude: "#e2c9a9",
  kaki: "#8b7355",
  "multi-colore": "linear-gradient(90deg, #ef4444 0%, #eab308 25%, #22c55e 50%, #3b82f6 75%, #a855f7 100%)",
};

function getColorHexFromLabel(label: string): string {
  const normalized = label.toLowerCase().trim().replace(/\s+/g, "-");
  return COLOR_LABEL_TO_HEX[normalized] ?? "#cccccc";
}

export type ItemInfoCardData = {
  pricePoints: number | null;
  likeCount?: number;
  exchangeCount?: number;
  itemRatingAverage?: number | null;
  itemRatingCount?: number;
  ratingValue?: string | number;
  ratingStars?: number;
  size: string;
  materials: string;
  color: string;
  brand: string;
  condition: string;
  /** Taille Segna recommandée (libellé affiché). */
  recommendedSize?: string;
  /** Précisions fit / taille. */
  sizeDescription?: string;
  /** Libellé catégorie pour audience Femme / Homme. */
  categoryLabel?: string | null;
  /** Collection (décennie ou année). */
  era?: string | null;
  /** Texte fitting (bulle taille). */
  fitting?: string | null;
  /** Dimensions brutes JSON (bulle taille). */
  dimensions?: unknown;
};

type ItemInfoCardProps = {
  data: ItemInfoCardData;
  className?: string;
  guestCashRental?: boolean;
  /** Masque la ligne prix (affichée ailleurs, ex. sous le titre produit). */
  hidePrice?: boolean;
};

export function ItemInfoCard({ data, className, guestCashRental = false, hidePrice = false }: ItemInfoCardProps) {
  const exchangeCount = Math.max(0, Math.floor(Number(data.exchangeCount ?? 0)));
  const itemRatingAverage =
    typeof data.itemRatingAverage === "number" && Number.isFinite(data.itemRatingAverage)
      ? Math.max(0, Math.min(5, data.itemRatingAverage))
      : null;
  const itemRatingCount = Math.max(0, Math.floor(Number(data.itemRatingCount ?? 0)));

  const firstLineItems: Array<{ key: string; content: React.ReactNode }> = [];

  if (!hidePrice) {
    firstLineItems.push({
      key: "price",
      content: (
        <span className={cn(montserrat.className, "flex items-center gap-1.5 font-bold text-zinc-900")}>
          {data.pricePoints != null ? (
            guestCashRental ? (
              <ItemWeeklyRentalPriceDisplay
                pricePoints={data.pricePoints}
                priceClassName={cn(montserrat.className, "font-bold text-zinc-900")}
              />
            ) : (
              <SegnaPointsUnitDisplay
                points={data.pricePoints}
                creditKind="consumption"
                unitDisplay="icon"
                className="gap-x-1.5"
                numberClassName={cn(montserrat.className, "font-bold text-zinc-900")}
              />
            )
          ) : (
            "En cours d’évaluation"
          )}
        </span>
      ),
    });
  }

  // 2. Taille (« Taille M » ou « Taille unique » si absent)
  {
    const trimmedSize = data.size?.trim() ?? "";
    const isPlaceholder =
      trimmedSize === "" || trimmedSize === "-" || trimmedSize === "—" || trimmedSize === "–";
    const hasSize = !isPlaceholder;
    firstLineItems.push({
      key: "size",
      content: (
        <span className={cn(montserrat.className, "shrink-0 font-semibold text-zinc-900")}>
          {hasSize ? formatItemSizeLabel(trimmedSize) : "Taille unique"}
        </span>
      ),
    });
  }

  // 3. Couleur (pastille + nom) / Matériaux
  if (data.color && data.color !== "-") {
    const hex = getColorHexFromLabel(data.color);
    const isGradient = hex.startsWith("linear-gradient");
    const displayLabel = data.color.replace(/-/g, " ");
    firstLineItems.push({
      key: "color",
      content: (
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300"
            style={isGradient ? { background: hex } : { backgroundColor: hex }}
            title={displayLabel}
            aria-hidden
          />
          <span className={cn(montserrat.className, "shrink-0 font-semibold text-zinc-900 capitalize")}>{displayLabel}</span>
        </span>
      ),
    });
  }
  if (data.materials && data.materials !== "-") {
    firstLineItems.push({
      key: "materials",
      content: (
        <span className={cn(montserrat.className, "shrink-0 font-semibold text-zinc-900")}>{data.materials}</span>
      ),
    });
  }

  return (
    <div
      className={cn(
        "w-full rounded-[10px] border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      {/* Ligne 1 : Prix / Taille / Avis / Couleur / Matériaux */}
      <div className="overflow-x-auto overflow-y-hidden pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center">
          {firstLineItems.map((item, index) => (
            <span key={item.key} className="flex items-center">
              {index > 0 ? (
                <span className="mx-4 w-px shrink-0 self-stretch bg-zinc-200" aria-hidden />
              ) : null}
              <span className="shrink-0">{item.content}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Ligne 2 : Marque (à la place de localisation) */}
      {data.brand && data.brand !== "-" ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
          <Tag className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>{data.brand}</span>
        </div>
      ) : null}

      {/* Ligne 3 : État */}
      <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
        <Package className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
        <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
          {data.condition && data.condition !== "-" ? data.condition : "—"}
        </span>
      </div>

      {/* Ligne 4 : Historique d'échanges */}
      {exchangeCount > 0 ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 pt-4 pb-2">
          <Repeat2 className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
            {exchangeCount} {exchangeCount > 1 ? "échanges faits" : "échange fait"}
          </span>
        </div>
      ) : null}

      {itemRatingAverage != null && itemRatingCount > 0 ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 pt-4 pb-2">
          <Star className="h-6 w-6 shrink-0 fill-zinc-900 text-zinc-900" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
            {itemRatingAverage.toFixed(1)}/5 · {itemRatingCount} {itemRatingCount > 1 ? "notes" : "note"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
