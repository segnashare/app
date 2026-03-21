"use client";

import { Montserrat } from "next/font/google";
import { Package, Tag } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const SEGNA_ICON_PATH = "/ressources/icons/segna.svg";
const STAR_ICON_PATH = "/ressources/icons/star.svg";
const RATING_STARS = 5;

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
  ratingValue?: string | number;
  ratingStars?: number;
  size: string;
  materials: string;
  color: string;
  brand: string;
  condition: string;
};

type ItemInfoCardProps = {
  data: ItemInfoCardData;
  className?: string;
};

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <img
      src={STAR_ICON_PATH}
      alt=""
      className={cn("h-[18px] w-[18px] shrink-0", filled ? "opacity-100" : "opacity-30")}
      aria-hidden
    />
  );
}

export function ItemInfoCard({ data, className }: ItemInfoCardProps) {
  const stars = Math.min(RATING_STARS, Math.max(0, data.ratingStars ?? 5));
  const ratingDisplay = data.ratingValue ?? "5.0";

  const firstLineItems: Array<{ key: string; content: React.ReactNode }> = [];

  // 1. Prix en mods (x + icône crédit Segna)
  firstLineItems.push({
    key: "price",
    content: (
      <span className={cn(montserrat.className, "flex items-center gap-1.5 font-bold text-zinc-900")}>
        {data.pricePoints != null ? data.pricePoints : "—"}
        <img src={SEGNA_ICON_PATH} alt="" className="h-5 w-5 shrink-0" aria-hidden />
      </span>
    ),
  });

  // 2. Avis (note + étoiles)
  firstLineItems.push({
    key: "rating",
    content: (
      <div className="flex items-center gap-2">
        <span className={cn(montserrat.className, "font-bold text-zinc-900")}>{String(ratingDisplay)}</span>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: RATING_STARS }, (_, i) => (
            <StarIcon key={i} filled={i < stars} />
          ))}
        </div>
      </div>
    ),
  });

  // 3. Couleur (pastille) / Taille / Matériaux
  if (data.color && data.color !== "-") {
    const hex = getColorHexFromLabel(data.color);
    const isGradient = hex.startsWith("linear-gradient");
    firstLineItems.push({
      key: "color",
      content: (
        <span
          className="inline-block h-6 w-6 shrink-0 rounded-full border border-zinc-300"
          style={isGradient ? { background: hex } : { backgroundColor: hex }}
          title={data.color}
          aria-label={data.color}
        />
      ),
    });
  }
  if (data.size && data.size !== "-") {
    firstLineItems.push({
      key: "size",
      content: (
        <span className={cn(montserrat.className, "shrink-0 font-semibold text-zinc-900")}>{data.size}</span>
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
      {/* Ligne 1 : Prix / Avis / Taille / Matériaux / Couleur */}
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

      {/* Ligne 3 : État (à la place de profession) */}
      <div className="flex items-center gap-4 border-t border-zinc-100 pt-4 pb-2">
        <Package className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
        <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
          {data.condition && data.condition !== "-" ? data.condition : "—"}
        </span>
      </div>
    </div>
  );
}
