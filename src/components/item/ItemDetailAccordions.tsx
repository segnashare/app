"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import type { ItemInfoCardData } from "./ItemInfoCard";
import { shouldShowItemExpertAuthentication } from "@/lib/items/item-expert-authentication";
import { itemDescriptionToSafeHtml } from "@/lib/items/item-description-format";
import { formatItemEraLabel } from "@/lib/items/item-era-fitting-dimensions";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type AccordionItemProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

function AccordionItem({ title, children, defaultOpen = false }: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="border-b border-zinc-200 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={cn(montserrat.className, "text-[13px] font-semibold uppercase tracking-[0.04em] text-zinc-900")}>
          {title}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-zinc-900" strokeWidth={2} aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-900" strokeWidth={2} aria-hidden />
        )}
      </button>
      {open ? (
        <div
          id={panelId}
          className={cn(montserrat.className, "space-y-1.5 pb-4 text-[14px] leading-relaxed text-zinc-700")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;

  return (
    <p>
      <span className="font-semibold text-zinc-900">{label} :</span> {trimmed}
    </p>
  );
}

type ItemDetailAccordionsProps = {
  description?: string;
  infoCard: Pick<ItemInfoCardData, "brand" | "pricePoints" | "materials" | "color" | "era">;
  className?: string;
};

export function ItemDetailAccordions({ description, infoCard, className }: ItemDetailAccordionsProps) {
  const descriptionHtml = useMemo(() => itemDescriptionToSafeHtml(description), [description]);
  const materials = infoCard.materials?.trim() ?? "";
  const color = infoCard.color?.trim() ?? "";
  const eraLabel = formatItemEraLabel(infoCard.era) ?? "";

  const showDescriptionSection =
    Boolean(descriptionHtml) ||
    Boolean(eraLabel) ||
    (materials && materials !== "—") ||
    (color && color !== "—");

  const showAuthentication = shouldShowItemExpertAuthentication(infoCard.brand, infoCard.pricePoints);

  if (!showDescriptionSection && !showAuthentication) return null;

  return (
    <div className={className}>
      {showDescriptionSection ? (
        <AccordionItem title="Description & mesures" defaultOpen>
          <DetailLine label="Collection" value={eraLabel} />
          <DetailLine label="Couleur" value={color} />
          <DetailLine label="Matériaux" value={materials} />
          {descriptionHtml ? (
            <div
              className={cn(
                "item-description-html space-y-2 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:text-zinc-900",
                "[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-zinc-900",
                "[&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-zinc-900",
                "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
                "[&_li]:my-0.5",
              )}
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          ) : null}
        </AccordionItem>
      ) : null}

      {showAuthentication ? (
        <AccordionItem title="Authentification & Certification">
          <p>
            Chaque pièce est soigneusement <strong className="font-semibold text-zinc-900">inspectée</strong> et{" "}
            <strong className="font-semibold text-zinc-900">authentifiée</strong> par notre équipe. Nous vérifions
            la qualité, l&apos;originalité et la conformité de chaque article,{" "}
            <strong className="font-semibold text-zinc-900">
              forts de plusieurs années d&apos;expérience dans la mode de seconde main.
            </strong>{" "}
            L&apos;état et les mesures sont clairement indiqués pour une transparence totale.
          </p>
        </AccordionItem>
      ) : null}
    </div>
  );
}
