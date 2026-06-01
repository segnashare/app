"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { ItemIntakePanel } from "@/components/item/ItemIntakePanel";
import { InAppOnboardingCartSheet } from "@/components/onboarding/InAppOnboardingCartSheet";
import { InAppOnboardingExchangeSheet } from "@/components/onboarding/InAppOnboardingExchangeSheet";
import { InAppOnboardingKycSheet } from "@/components/onboarding/InAppOnboardingKycSheet";
import { InAppOnboardingProfileSheet } from "@/components/onboarding/InAppOnboardingProfileSheet";
import type { OutboundShipmentSummary } from "@/lib/cart/fetch-outbound-shipment-summary";
import { cn } from "@/lib/utils/cn";

import type { ExchangeIntakeBannerItem } from "./exchange-intake-banner-types";
import {
  ExchangeOutboundShipmentCallout,
  outboundCalloutDismissStorageKey,
} from "./ExchangeOutboundShipmentCallout";
import { ExchangeUberRelayFallbackBanner } from "./ExchangeUberRelayFallbackBanner";
import {
  getIntakeSessionAckServerStoreSnapshot,
  getIntakeSessionAckStoreSnapshot,
  intakeSessionAckKey,
  parseIntakeSessionAckStoreSnapshot,
  readIntakeSessionAckSet,
  subscribeIntakeSessionAck,
  writeIntakeSessionAckSet,
} from "@/lib/items/intake-session-ack";
import {
  getExchangeOnboardingSheetDismissSnapshot,
  parseExchangeOnboardingSheetDismissSnapshot,
  subscribeExchangeOnboardingSheetDismiss,
} from "@/lib/onboarding/in-app-onboarding";

export type { ExchangeIntakeBannerItem } from "./exchange-intake-banner-types";

/** Décalage entre cartes : léger décalage pour lire la pile, sans révéler le contenu (silhouettes). */
const STACK_PEEK_PX = 8;
const STACK_SCALE_STEP = 0.008;
/** Plancher minimal (file d’attente sous la carte du dessus). */
const STACK_MIN_FRONT_HEIGHT_PX = 196;
/** Avant mesure ResizeObserver : proche du plancher pour limiter le vide sous la pile au 1er paint. */
const STACK_PRE_MEASURE_FALLBACK_PX = Math.ceil(STACK_MIN_FRONT_HEIGHT_PX + STACK_PEEK_PX * 3);

function readOutboundHidden(summary: OutboundShipmentSummary | null): boolean {
  if (!summary || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(outboundCalloutDismissStorageKey(summary.cartId, summary.status)) === "1";
  } catch {
    return false;
  }
}

type StackLayer =
  | { kind: "onboarding-profile" }
  | { kind: "onboarding-kyc" }
  | { kind: "onboarding-cart" }
  | { kind: "onboarding-exchange" }
  | { kind: "intake"; item: ExchangeIntakeBannerItem }
  | { kind: "outbound"; summary: OutboundShipmentSummary };

const CARD_SHELL_CLASS =
  "overflow-hidden rounded-2xl border border-zinc-200/90 shadow-[0_6px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05]";

function getExchangeOnboardingDismissServerSnapshot() {
  return "[]";
}

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
  defaultShippingGroupIds = [],
  outboundSummary,
  showProfileOnboarding = false,
  showKycOnboarding = false,
  showCartOnboarding = false,
  showExchangeOnboarding = false,
  uberRelayFallback = false,
}: {
  intakeItems: ExchangeIntakeBannerItem[];
  /** Pièces prêtes à expédier : lien bordereau groupé par défaut. */
  defaultShippingGroupIds?: string[];
  outboundSummary: OutboundShipmentSummary | null;
  /** Onboarding in-app : carte profil placée dans la pile haute Échange. */
  showProfileOnboarding?: boolean;
  /** Onboarding in-app : carte KYC placée dans la pile haute Échange. */
  showKycOnboarding?: boolean;
  /** Onboarding in-app : carte panier placée dans la pile haute Échange. */
  showCartOnboarding?: boolean;
  /** Onboarding in-app : carte prêt de pièce placée dans la pile haute Échange. */
  showExchangeOnboarding?: boolean;
  /** Uber prévu mais course non créée : message + contact pour basculer en relais MR. */
  uberRelayFallback?: boolean;
}) {
  const router = useRouter();
  const intakeAckSnapshot = useSyncExternalStore(
    subscribeIntakeSessionAck,
    getIntakeSessionAckStoreSnapshot,
    getIntakeSessionAckServerStoreSnapshot,
  );
  const intakeAck = useMemo(
    () => parseIntakeSessionAckStoreSnapshot(intakeAckSnapshot),
    [intakeAckSnapshot],
  );
  const [outboundHidden, setOutboundHidden] = useState(false);
  const onboardingDismissSnapshot = useSyncExternalStore(
    subscribeExchangeOnboardingSheetDismiss,
    getExchangeOnboardingSheetDismissSnapshot,
    getExchangeOnboardingDismissServerSnapshot,
  );
  const dismissedOnboardingSheets = useMemo(
    () => parseExchangeOnboardingSheetDismissSnapshot(onboardingDismissSnapshot),
    [onboardingDismissSnapshot],
  );

  useEffect(() => {
    if (!outboundSummary) {
      setOutboundHidden(false);
      return;
    }
    setOutboundHidden(readOutboundHidden(outboundSummary));
  }, [outboundSummary?.cartId, outboundSummary?.status]);

  const visibleIntakes = useMemo(
    () =>
      intakeItems.filter(
        (item) => !intakeAck.has(intakeSessionAckKey(item.id, item.listingStage, item.fulfillmentStage)),
      ),
    [intakeItems, intakeAck],
  );

  const layers = useMemo(() => {
    const list: StackLayer[] =
      showProfileOnboarding && !dismissedOnboardingSheets.has("profile")
        ? [{ kind: "onboarding-profile" }]
        : [];
    if (showKycOnboarding && !dismissedOnboardingSheets.has("kyc")) {
      list.push({ kind: "onboarding-kyc" });
    }
    if (showCartOnboarding && !dismissedOnboardingSheets.has("panier")) {
      list.push({ kind: "onboarding-cart" });
    }
    if (showExchangeOnboarding && !dismissedOnboardingSheets.has("exchange")) {
      list.push({ kind: "onboarding-exchange" });
    }
    list.push(...visibleIntakes.map((item) => ({ kind: "intake" as const, item })));
    if (outboundSummary != null && !outboundHidden) {
      list.push({ kind: "outbound", summary: outboundSummary });
    }
    return list;
  }, [
    showProfileOnboarding,
    showKycOnboarding,
    showCartOnboarding,
    showExchangeOnboarding,
    dismissedOnboardingSheets,
    visibleIntakes,
    outboundSummary,
    outboundHidden,
  ]);

  const persistIntakeAck = useCallback(
    (itemId: string, listingStage: string, fulfillmentStage: string | null) => {
      const next = new Set(readIntakeSessionAckSet());
      next.add(intakeSessionAckKey(itemId, listingStage, fulfillmentStage));
      writeIntakeSessionAckSet(next);
    },
    [],
  );

  const frontLayerKey = useMemo(() => {
    const first = layers[0];
    if (!first) return "";
    if (first.kind === "onboarding-profile") return "onboarding:profile";
    if (first.kind === "onboarding-kyc") return "onboarding:kyc";
    if (first.kind === "onboarding-cart") return "onboarding:cart";
    if (first.kind === "onboarding-exchange") return "onboarding:exchange";
    return first.kind === "intake"
      ? `in:${intakeSessionAckKey(first.item.id, first.item.listingStage, first.item.fulfillmentStage)}`
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

          if (layer.kind === "onboarding-profile") {
            return (
              <div
                key="onboarding-profile"
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "bg-white")}>
                    <InAppOnboardingProfileSheet />
                  </div>
                ) : (
                  <div className="pointer-events-none select-none opacity-[0.92]">
                    <StackCardSilhouette heightPx={frontBasis} />
                  </div>
                )}
              </div>
            );
          }

          if (layer.kind === "onboarding-kyc") {
            return (
              <div
                key="onboarding-kyc"
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "bg-white")}>
                    <InAppOnboardingKycSheet />
                  </div>
                ) : (
                  <div className="pointer-events-none select-none opacity-[0.92]">
                    <StackCardSilhouette heightPx={frontBasis} />
                  </div>
                )}
              </div>
            );
          }

          if (layer.kind === "onboarding-cart") {
            return (
              <div
                key="onboarding-cart"
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "bg-white")}>
                    <InAppOnboardingCartSheet />
                  </div>
                ) : (
                  <div className="pointer-events-none select-none opacity-[0.92]">
                    <StackCardSilhouette heightPx={frontBasis} />
                  </div>
                )}
              </div>
            );
          }

          if (layer.kind === "onboarding-exchange") {
            return (
              <div
                key="onboarding-exchange"
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "bg-white")}>
                    <InAppOnboardingExchangeSheet />
                  </div>
                ) : (
                  <div className="pointer-events-none select-none opacity-[0.92]">
                    <StackCardSilhouette heightPx={frontBasis} />
                  </div>
                )}
              </div>
            );
          }

          if (layer.kind === "intake") {
            const { item } = layer;
            const stackAdvance =
              item.listingStage === "evaluation" || item.listingStage === "evaluated"
                ? () => persistIntakeAck(item.id, item.listingStage, item.fulfillmentStage)
                : undefined;
            const onStackDismiss = () => {
              persistIntakeAck(item.id, item.listingStage, item.fulfillmentStage);
              router.refresh();
            };

            return (
              <div
                key={intakeSessionAckKey(item.id, item.listingStage, item.fulfillmentStage)}
                className="absolute left-0 right-0 top-0 origin-top will-change-transform"
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  zIndex,
                }}
                aria-hidden={!isFront}
              >
                {isFront ? (
                  <div ref={frontLayerRef} className={cn(CARD_SHELL_CLASS, "w-full bg-white")}>
                    <ItemIntakePanel
                      itemId={item.id}
                      itemTitle={item.title}
                      listingStage={item.listingStage}
                      fulfillmentStage={item.fulfillmentStage}
                      intakeMetadata={item.metadata}
                      intakeUpdatedAt={item.updatedAt}
                      offerPricePoints={item.pricePoints}
                      placement="item"
                      defaultShippingGroupIds={defaultShippingGroupIds}
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
