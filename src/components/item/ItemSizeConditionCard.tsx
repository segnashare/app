"use client";

import { Info } from "lucide-react";

import {
  formatItemConditionShortLabel,
  normalizeItemSizeValue,
  recommendedSizeAudienceFromCategoryLabel,
} from "@/lib/items/item-size-condition-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

export type ItemSizeConditionCardData = {
  labelSize: string;
  condition: string;
  recommendedSize: string;
  sizeDescription?: string;
  categoryLabel?: string | null;
};

type ItemSizeConditionCardProps = {
  data: ItemSizeConditionCardData;
  className?: string;
  variant?: "default" | "compact";
};

const CONDITION_INFO_TEXT =
  "Chaque pièce est inspectée avec soin pour garantir la qualité, l'authenticité et l'état. L'évaluation de l'état est réalisée par notre équipe sur la base d'une inspection visuelle. Consultez les photos et la description pour plus de détails.";

function InfoHint({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center text-zinc-400 transition-colors hover:text-zinc-600"
      aria-label={label}
      title={text}
    >
      <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </button>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <p className={cn(montserrat.className, "text-[12px] font-medium leading-none text-zinc-500")}>{children}</p>
      {hint}
    </div>
  );
}

function FieldValue({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(montserrat.className, "mt-1.5 text-[15px] font-semibold leading-none text-zinc-900")}>
      {children}
    </p>
  );
}

function InlineField({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <p className={cn(montserrat.className, "whitespace-nowrap text-[11px] leading-none text-zinc-500")}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {hint}
      </span>
      <span className="font-semibold text-zinc-900"> : {value}</span>
    </p>
  );
}

export function ItemSizeConditionCard({ data, className, variant = "default" }: ItemSizeConditionCardProps) {
  const labelSize = normalizeItemSizeValue(data.labelSize);
  const recommendedSize = normalizeItemSizeValue(data.recommendedSize);
  const condition = formatItemConditionShortLabel(data.condition);
  const audience = recommendedSizeAudienceFromCategoryLabel(data.categoryLabel);
  const sizeDescription = data.sizeDescription?.trim() ?? "";

  const recommendedLabel = audience ? `Taille recommandée ${audience}` : "Taille recommandée";
  const hasRecommendedSize = recommendedSize !== "—";
  const showSecondarySection = hasRecommendedSize || Boolean(sizeDescription);

  return (
    <div className={cn("rounded-2xl border border-zinc-200 bg-white px-4 py-4", className)}>
      {variant === "compact" ? (
        <div className="grid grid-cols-2 gap-x-1.5">
          <InlineField label="Taille" value={labelSize} />
          <InlineField
            label="État"
            value={condition}
            hint={
              <InfoHint
                label="Informations sur l'état"
                text={CONDITION_INFO_TEXT}
              />
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <FieldLabel>Taille étiquette</FieldLabel>
            <FieldValue>{labelSize}</FieldValue>
          </div>
          <div>
            <FieldLabel
              hint={
                <InfoHint
                  label="Informations sur l'état"
                  text={CONDITION_INFO_TEXT}
                />
              }
            >
              État
            </FieldLabel>
            <FieldValue>{condition}</FieldValue>
          </div>
        </div>
      )}

      {showSecondarySection ? (
        <>
          <div className="my-4 border-t border-zinc-200" />

          {hasRecommendedSize ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
              <FieldLabel
                hint={
                  <InfoHint
                    label="Informations sur la taille recommandée"
                    text="Taille conseillée par Segna selon le fit réel, qui peut différer de l'étiquette."
                  />
                }
              >
                {recommendedLabel}
              </FieldLabel>
              <p className={cn(montserrat.className, "pt-0.5 text-[15px] font-semibold leading-none text-zinc-900")}>
                {recommendedSize}
              </p>
              {sizeDescription ? (
                <p className={cn(montserrat.className, "col-span-2 text-[12px] leading-snug text-zinc-500")}>
                  {sizeDescription}
                </p>
              ) : null}
            </div>
          ) : sizeDescription ? (
            <p className={cn(montserrat.className, "text-[12px] leading-snug text-zinc-500")}>{sizeDescription}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
