"use client";

import { useMemo, useState } from "react";

import { Check, ChevronLeft, ChevronRight, Truck } from "lucide-react";

import { useCartShopHubUiOptional } from "@/components/cart/CartShopHubUiContext";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import {
  cartRelayFreeOfferUnlockedSubtext,
  complementQualifiesForFreeRelay,
  complementRelayOfferMissingEuros,
  complementRelayOfferProgressRatio,
  formatCartComplementMissingEuros,
  type CartRelayFreeOfferMode,
} from "@/lib/cart/cart-complement-relay-offer";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type CartComplementShippingIncentiveProps = {
  complementEuros: number;
  suggestionItems?: ShopCatalogItem[];
  cartItemIds?: string[];
  offerMode?: CartRelayFreeOfferMode;
};

function pickSuggestionItems(
  items: ShopCatalogItem[],
  excludedIds: Set<string>,
): ShopCatalogItem[] {
  const seen = new Set<string>();
  const out: ShopCatalogItem[] = [];
  for (const item of items) {
    if (!item.id || excludedIds.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= 12) break;
  }
  return out;
}

function SuggestionProductRow({
  item,
  coverUrl,
  inCart,
  busy,
  onAdd,
}: {
  item: ShopCatalogItem;
  coverUrl: string | undefined;
  inCart: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const title = [item.brand_label, item.title].filter(Boolean).join(" — ") || item.title || "Article";
  const points = item.price_points ?? 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
        {coverUrl ? (
          <RemoteCoverThumb photoUrl={coverUrl} frameClassName="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-zinc-400">
            —
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(montserrat.className, "truncate text-[13px] font-semibold text-zinc-900")}>{title}</p>
        {points > 0 ? (
          <SegnaPointsUnitDisplay
            points={points}
            creditKind="exchange"
            unitDisplay="icon"
            className="mt-0.5 gap-x-1"
            numberClassName={cn(montserrat.className, "text-[12px] font-medium text-zinc-500")}
          />
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy || inCart}
        onClick={onAdd}
        className={cn(
          montserrat.className,
          "shrink-0 rounded-lg px-3 py-2 text-[12px] font-bold transition",
          inCart
            ? "cursor-default bg-zinc-100 text-zinc-500"
            : "bg-zinc-950 text-white hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-60",
        )}
      >
        {inCart ? "Dans le panier" : busy ? "…" : "Ajouter"}
      </button>
    </div>
  );
}

export function CartComplementShippingIncentive({
  complementEuros,
  suggestionItems = [],
  cartItemIds = [],
  offerMode = "location",
}: CartComplementShippingIncentiveProps) {
  const shopHub = useCartShopHubUiOptional();
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const excludedIds = useMemo(() => {
    const ids = new Set(cartItemIds);
    if (shopHub) {
      for (const id of shopHub.localCartItemIds) ids.add(id);
    }
    return ids;
  }, [cartItemIds, shopHub]);

  const suggestions = useMemo(
    () => pickSuggestionItems(suggestionItems, excludedIds),
    [excludedIds, suggestionItems],
  );

  const activeSuggestion = suggestions.length > 0 ? suggestions[suggestionIndex % suggestions.length]! : null;

  const qualifies = complementQualifiesForFreeRelay(complementEuros, offerMode);

  if (!qualifies) {
    const missingEuros = complementRelayOfferMissingEuros(complementEuros, offerMode);
    const progressPct = Math.round(complementRelayOfferProgressRatio(complementEuros, offerMode) * 100);

    return (
      <div
        className={cn(
          montserrat.className,
          "mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4",
        )}
      >
        <div className="flex items-start gap-2.5">
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900" strokeWidth={2.2} aria-hidden />
          <p className="text-[14px] font-semibold leading-snug text-zinc-900">
            Plus que{" "}
            <span className="tabular-nums">{formatCartComplementMissingEuros(missingEuros)}</span> pour la livraison
            relais offerte
          </p>
        </div>

        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progression vers la livraison relais offerte : ${progressPct} pour cent`}
        >
          <div
            className="h-full rounded-full bg-zinc-950 transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {activeSuggestion && shopHub ? (
          <div className="mt-4 flex items-center gap-1 border-t border-zinc-100 pt-4">
            <button
              type="button"
              disabled={suggestions.length <= 1}
              aria-label="Suggestion précédente"
              onClick={() =>
                setSuggestionIndex((i) => (suggestions.length <= 1 ? i : (i - 1 + suggestions.length) % suggestions.length))
              }
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <SuggestionProductRow
              item={activeSuggestion}
              coverUrl={shopHub.coverUrlById[activeSuggestion.id]}
              inCart={shopHub.localCartItemIds.has(activeSuggestion.id)}
              busy={shopHub.cartBusyIds.has(activeSuggestion.id)}
              onAdd={() => void shopHub.handleToggleCart(activeSuggestion.id)}
            />
            <button
              type="button"
              disabled={suggestions.length <= 1}
              aria-label="Suggestion suivante"
              onClick={() =>
                setSuggestionIndex((i) => (suggestions.length <= 1 ? i : (i + 1) % suggestions.length))
              }
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        montserrat.className,
        "mt-4 flex items-start gap-2.5 rounded-2xl border border-zinc-200 bg-white p-4",
      )}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-zinc-900">
        <Check className="h-3 w-3 text-zinc-900" strokeWidth={3} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug text-zinc-900">Livraison point relais offerte</p>
        <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{cartRelayFreeOfferUnlockedSubtext(offerMode)}</p>
      </div>
    </div>
  );
}
