"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ItemIntakePanel } from "@/components/item/ItemIntakePanel";
import type { OutboundShipmentSummary } from "@/lib/cart/fetch-outbound-shipment-summary";
import { cn } from "@/lib/utils/cn";

import type { ExchangeIntakeBannerItem } from "./exchange-intake-banner-types";
import {
  ExchangeOutboundShipmentCallout,
  outboundCalloutDismissStorageKey,
} from "./ExchangeOutboundShipmentCallout";
import { ExchangeUberRelayFallbackBanner } from "./ExchangeUberRelayFallbackBanner";

export type { ExchangeIntakeBannerItem } from "./exchange-intake-banner-types";

const INTAKE_STACK_ACK_KEY = "segna:exchange:intake-stack-ack";
/** Décalage entre cartes : léger décalage pour lire la pile, sans révéler le contenu (silhouettes). */
const STACK_PEEK_PX = 8;
const STACK_SCALE_STEP = 0.008;
/** Plancher minimal (file d’attente sous la carte du dessus). */
const STACK_MIN_FRONT_HEIGHT_PX = 196;
/** Avant mesure ResizeObserver : proche du plancher pour limiter le vide sous la pile au 1er paint. */
const STACK_PRE_MEASURE_FALLBACK_PX = Math.ceil(STACK_MIN_FRONT_HEIGHT_PX + STACK_PEEK_PX * 3);

function intakeAckKey(itemId: string, listingStage: string): string {
  return `${itemId}:${listingStage}`;
}

function readIntakeAckSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(INTAKE_STACK_ACK_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeIntakeAckSet(next: Set<string>): void {
  try {
    window.sessionStorage.setItem(INTAKE_STACK_ACK_KEY, JSON.stringify([...next]));
  } catch {
    // no-op
  }
}

function readOutboundHidden(summary: OutboundShipmentSummary | null): boolean {
  if (!summary || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(outboundCalloutDismissStorageKey(summary.cartId, summary.status)) === "1";
  } catch {
    return false;
  }
}

type StackLayer =
  | { kind: "intake"; item: ExchangeIntakeBannerItem }
  | { kind: "outbound"; summary: OutboundShipmentSummary };

const CARD_SHELL_CLASS =
  "overflow-hidden rounded-2xl border border-zinc-200/90 shadow-[0_6px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05]";

/**
 * Coque sans contenu : même gabarit que la carte du dessus pour l’effet pile, sans boutons ni texte qui dépassent.
 */
function StackCardSilhouette({ heightPx }: { heightPx: number }) {
  return (
    <div
      className={cn(CARD_SHELL_CLASS, "bg-zinc-100/90")}
      style={{ height: heightPx }}
      aria-hidden
    />
  );
}

/**
 * Pile type « dossiers » sous le header Échange : cartes superposées avec léger décalage,
 * la carte du dessus seule est interactive ; intakes + suivi colis dans le même empilement.
 */
export function ExchangeHeaderAlertStack({
  intakeItems,
  outboundSummary,
  uberRelayFallback = false,
}: {
  intakeItems: ExchangeIntakeBannerItem[];
  outboundSummary: OutboundShipmentSummary | null;
  /** Uber prévu mais course non créée : message + contact pour basculer en relais MR. */
  uberRelayFallback?: boolean;
}) {
  const router = useRouter();
  const [intakeAck, setIntakeAck] = useState<Set<string>>(() => new Set());
  const [outboundHidden, setOutboundHidden] = useState(false);

  useEffect(() => {
    setIntakeAck(readIntakeAckSet());
  }, []);

  useEffect(() => {
    if (!outboundSummary) {
      setOutboundHidden(false);
      return;
    }
    setOutboundHidden(readOutboundHidden(outboundSummary));
  }, [outboundSummary?.cartId, outboundSummary?.status]);

  const visibleIntakes = useMemo(
    () => intakeItems.filter((item) => !intakeAck.has(intakeAckKey(item.id, item.listingStage))),
    [intakeItems, intakeAck],
  );

  const layers = useMemo(() => {
    const list: StackLayer[] = visibleIntakes.map((item) => ({ kind: "intake" as const, item }));
    if (outboundSummary != null && !outboundHidden) {
      list.push({ kind: "outbound", summary: outboundSummary });
    }
    return list;
  }, [visibleIntakes, outboundSummary, outboundHidden]);

  const persistIntakeAck = useCallback((itemId: string, listingStage: string) => {
    setIntakeAck((prev) => {
      const next = new Set(prev);
      next.add(intakeAckKey(itemId, listingStage));
      writeIntakeAckSet(next);
      return next;
    });
  }, []);

  const frontLayerKey = useMemo(() => {
    const first = layers[0];
    if (!first) return "";
    return first.kind === "intake"
      ? `in:${intakeAckKey(first.item.id, first.item.listingStage)}`
      : `out:${first.summary.cartId}:${first.summary.status}`;
  }, [layers]);

  const frontLayerRef = useRef<HTMLDivElement | null>(null);
  const [frontHeightPx, setFrontHeightPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = frontLayerRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) setFrontHeightPx(h);
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [frontLayerKey, layers.length]);

  if (layers.length === 0 && !uberRelayFallback) return null;

  const peekTotal = Math.max(0, layers.length - 1) * STACK_PEEK_PX;
  const frontBasis = frontHeightPx ?? STACK_PRE_MEASURE_FALLBACK_PX;
  /** Hauteur utile seulement : évite le vide sous une carte plus basse que le plancher historique (196px). */
  const stackMinHeight =
    layers.length === 0
      ? 0
      : frontHeightPx != null
        ? frontBasis + peekTotal
        : STACK_PRE_MEASURE_FALLBACK_PX + peekTotal;

  return (
    <div className="space-y-2 px-5 pb-1">
      {uberRelayFallback ? (
        <div className="mx-auto w-full max-w-[460px]">
          <ExchangeUberRelayFallbackBanner />
        </div>
      ) : null}
      {layers.length === 0 ? null : (
      <div
        className="relative mx-auto w-full max-w-[460px]"
        style={{ minHeight: stackMinHeight }}
        aria-label="Alertes — traiter la carte du dessus"
      >
        {layers.map((layer, index) => {
          const isFront = index === 0;
          const zIndex = 32 + (layers.length - index);
          const translateY = index * STACK_PEEK_PX;
          const scale = 1 - index * STACK_SCALE_STEP;

          if (layer.kind === "intake") {
            const { item } = layer;
            const stackAdvance =
              item.listingStage === "evaluation" || item.listingStage === "evaluated"
                ? () => persistIntakeAck(item.id, item.listingStage)
                : undefined;
            const onStackDismiss = () => {
              persistIntakeAck(item.id, item.listingStage);
              router.refresh();
            };

            return (
              <div
                key={intakeAckKey(item.id, item.listingStage)}
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "bg-white")}>
                    <ItemIntakePanel
                      itemId={item.id}
                      listingStage={item.listingStage}
                      fulfillmentStage={item.fulfillmentStage}
                      intakeMetadata={item.metadata}
                      intakeUpdatedAt={item.updatedAt}
                      offerPricePoints={item.pricePoints}
                      placement="item"
                      onPipelineUpdated={() => router.refresh()}
                      onExchangeStackAdvance={stackAdvance}
                      onStackDismiss={onStackDismiss}
                    />
                  </div>
                ) : (
                  <div className="pointer-events-none select-none opacity-[0.92]">
                    <StackCardSilhouette heightPx={frontBasis} />
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={`outbound-${layer.summary.cartId}-${layer.summary.status}`}
              className="absolute left-0 right-0 top-0 origin-top will-change-transform"
              style={{
                transform: `translateY(${translateY}px) scale(${scale})`,
                zIndex,
              }}
              aria-hidden={!isFront}
            >
              {isFront ? (
                <div ref={frontLayerRef}>
                  <ExchangeOutboundShipmentCallout
                    summary={layer.summary}
                    embedded
                    stackInteractive
                    onDismissed={() => setOutboundHidden(true)}
                  />
                </div>
              ) : (
                <div className="pointer-events-none select-none opacity-[0.92]">
                  <StackCardSilhouette heightPx={frontBasis} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
