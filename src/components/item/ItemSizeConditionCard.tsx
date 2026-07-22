"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

import { openItemChat } from "@/lib/item-chat/client-storage";
import {
  formatItemConditionShortLabel,
  normalizeItemSizeValue,
  recommendedSizeAudienceFromCategoryLabel,
} from "@/lib/items/item-size-condition-display";
import { formatItemDimensionDisplayValue } from "@/lib/items/item-era-fitting-dimensions";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

export type ItemSizeDimensionRow = { label: string; value: string };

export type ItemSizeConditionCardData = {
  labelSize: string;
  condition: string;
  recommendedSize: string;
  sizeDescription?: string;
  categoryLabel?: string | null;
  fitting?: string | null;
  dimensions?: ItemSizeDimensionRow[];
};

export type ItemSizeConditionAskChat = {
  itemId: string;
  itemTitle?: string | null;
};

type ItemSizeConditionCardProps = {
  data: ItemSizeConditionCardData;
  className?: string;
  variant?: "default" | "compact";
  askChat?: ItemSizeConditionAskChat | null;
};

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

function SizeDetailsBubble({
  open,
  panelId,
  fitting,
  dimensions,
  onClose,
  anchorRef,
}: {
  open: boolean;
  panelId: string;
  fitting: string;
  dimensions: ItemSizeDimensionRow[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; arrowLeft: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setCoords(null);
      return;
    }
    const place = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      const margin = 12;
      const anchorX = rect.left + rect.width / 2;
      let left = anchorX - width / 2;
      if (left < margin) left = margin;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
      const arrowPad = 14;
      const arrowLeft = Math.min(Math.max(anchorX - left, arrowPad), width - arrowPad);
      setCoords({ top: rect.top - 10, left, width, arrowLeft });
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, fitting, dimensions]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (bubbleRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !coords || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={bubbleRef}
      id={panelId}
      role="dialog"
      aria-label="Fitting et dimensions"
      style={{ top: coords.top, left: coords.left, width: coords.width }}
      className={cn(
        montserrat.className,
        "fixed z-[80] -translate-y-full rounded-md bg-[#2a2a2a] px-3.5 py-3 text-white shadow-xl shadow-black/25",
      )}
    >
      <span
        className="absolute -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 bg-[#2a2a2a]"
        style={{ left: coords.arrowLeft }}
        aria-hidden
      />
      {fitting ? (
        <div className="relative space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Fitting</p>
          <p className="text-[13px] leading-snug whitespace-pre-wrap text-white/95">{fitting}</p>
        </div>
      ) : null}
      {dimensions.length ? (
        <div className={cn("relative", fitting ? "mt-3 space-y-1.5" : "space-y-1.5")}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Dimensions</p>
          <ul className="space-y-1">
            {dimensions.map((d) => (
              <li key={d.label} className="flex justify-between gap-3 text-[13px] text-white/95">
                <span className="text-white/55">{d.label}</span>
                <span className="font-semibold italic text-white">
                  {formatItemDimensionDisplayValue(d.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export function ItemSizeConditionCard({
  data,
  className,
  variant = "default",
  askChat = null,
}: ItemSizeConditionCardProps) {
  const panelId = useId();
  const [sizeInfoOpen, setSizeInfoOpen] = useState(false);
  const infoBtnRef = useRef<HTMLButtonElement>(null);

  const labelSize = normalizeItemSizeValue(data.labelSize);
  const recommendedSize = normalizeItemSizeValue(data.recommendedSize);
  const condition = formatItemConditionShortLabel(data.condition);
  const audience = recommendedSizeAudienceFromCategoryLabel(data.categoryLabel);
  const sizeDescription = data.sizeDescription?.trim() ?? "";
  const fitting = data.fitting?.trim() ?? "";
  const dimensions = (data.dimensions ?? []).filter((d) => d.value.trim());
  const hasSizeDetails = Boolean(fitting) || dimensions.length > 0;

  const recommendedLabel = audience ? `Taille recommandée ${audience}` : "Taille recommandée";
  const hasRecommendedSize = recommendedSize !== "—";
  const showSecondarySection = hasRecommendedSize || Boolean(sizeDescription);
  const showAskLink = Boolean(askChat?.itemId) && variant === "default";

  return (
    <div className={cn("rounded-2xl border border-zinc-200 bg-white px-4 py-4", className)}>
      {variant === "compact" ? (
        <div className="grid grid-cols-2 gap-x-1.5">
          <InlineField label="Taille" value={labelSize} />
          <InlineField label="État" value={condition} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <FieldLabel
              hint={
                hasSizeDetails ? (
                  <>
                    <button
                      ref={infoBtnRef}
                      type="button"
                      className="inline-flex shrink-0 items-center text-zinc-400 transition-colors hover:text-zinc-600"
                      aria-label="Détails taille : fitting et dimensions"
                      aria-expanded={sizeInfoOpen}
                      aria-controls={panelId}
                      onClick={() => setSizeInfoOpen((v) => !v)}
                    >
                      <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    </button>
                    <SizeDetailsBubble
                      open={sizeInfoOpen}
                      panelId={panelId}
                      fitting={fitting}
                      dimensions={dimensions}
                      onClose={() => setSizeInfoOpen(false)}
                      anchorRef={infoBtnRef}
                    />
                  </>
                ) : undefined
              }
            >
              Taille étiquette
            </FieldLabel>
            <FieldValue>{labelSize}</FieldValue>
          </div>
          <div>
            <FieldLabel>État</FieldLabel>
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

      {showAskLink && askChat ? (
        <>
          <div className="my-4 border-t border-zinc-200" />
          <button
            type="button"
            onClick={() =>
              openItemChat({
                itemId: askChat.itemId,
                itemTitle: askChat.itemTitle,
                itemSizeLabel: labelSize,
                itemConditionLabel: condition,
              })
            }
            className={cn(
              montserrat.className,
              "flex w-full appearance-none items-start gap-2 border-0 bg-transparent p-0 text-left shadow-none outline-none",
            )}
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
            </svg>
            <span className="text-[13px] font-semibold leading-snug text-zinc-900 underline decoration-zinc-400 underline-offset-[3px] transition hover:decoration-zinc-900">
              Une question sur la taille, l&apos;état ou un autre détail&nbsp;? Écris-nous.
            </span>
          </button>
        </>
      ) : null}
    </div>
  );
}
