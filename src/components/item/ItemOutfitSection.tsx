"use client";

import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import type { ItemOutfitCompanionRef, ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { ItemWeeklyRentalPriceDisplay } from "@/components/ui/ItemWeeklyRentalPriceDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type ItemOutfitSectionProps = {
  outfit: ItemOutfitLookPayload;
  companionItems: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  guestCashRental?: boolean;
};

function companionRoleLabel(companion: ItemOutfitCompanionRef, item: ShopCatalogItem): string | null {
  if (companion.role_label?.trim()) return companion.role_label.trim();
  if (item.category_label?.trim()) return item.category_label.trim();
  return null;
}

export function ItemOutfitSection({
  outfit,
  companionItems,
  initialCoverUrlById = {},
  guestCashRental = false,
}: ItemOutfitSectionProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(initialCoverUrlById);

  const availableCompanions = useMemo(() => {
    const byId = new Map(companionItems.map((item) => [item.id, item]));
    return outfit.companions
      .map((companion) => {
        const item = byId.get(companion.item_id);
        if (!item) return null;
        if (item.status !== "available" && item.status !== "in_cart") return null;
        return { companion, item };
      })
      .filter((row): row is { companion: ItemOutfitCompanionRef; item: ShopCatalogItem } => row !== null);
  }, [companionItems, outfit.companions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pathByItemId = new Map<string, string>();
      for (const { item } of availableCompanions) {
        if (coverUrlById[item.id]) continue;
        const path = getFirstPhotoStoragePath(item.photos);
        if (!path) continue;
        pathByItemId.set(item.id, path);
      }
      if (pathByItemId.size === 0) return;
      const signedByPath = await createSignedUrlsForStoragePaths(supabase, [...pathByItemId.values()], 60 * 60 * 24);
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const [id, path] of pathByItemId) {
        const url = signedByPath.get(path);
        if (url) updates[id] = url;
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [availableCompanions, coverUrlById, supabase]);

  if (availableCompanions.length === 0) return null;

  const hasIntro = Boolean(outfit.title.trim() || outfit.intro.trim());

  return (
    <div className="space-y-4">
      {hasIntro ? (
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          {outfit.title.trim() ? (
            <h3 className={cn(segnaPlayfairDisplay.className, "text-[20px] font-semibold leading-tight text-zinc-950")}>
              Idée de tenue
            </h3>
          ) : null}
          {outfit.title.trim() ? (
            <p className="mt-1 text-sm font-semibold text-zinc-800">{outfit.title.trim()}</p>
          ) : null}
          {outfit.intro.trim() ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{outfit.intro.trim()}</p>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
        <h3 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME, "text-[20px]")}>
          Complétez la tenue
        </h3>
        <ul className="mt-3 divide-y divide-zinc-100">
          {availableCompanions.map(({ companion, item }) => {
            const inCart = cartItemIds.has(item.id);
            const busy = cartBusyIds.has(item.id);
            const canAdd = item.status === "available" || item.status === "in_cart";
            const role = companionRoleLabel(companion, item);
            return (
              <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Link href={`/items/${item.id}?from=shop`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                    {coverUrlById[item.id] ? (
                      <RemoteCoverThumb photoUrl={coverUrlById[item.id]} frameClassName="h-full w-full" photoCoverFill />
                    ) : (
                      <div className="h-full w-full bg-zinc-100" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {role ? <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{role}</p> : null}
                    <p className="truncate text-sm font-semibold text-zinc-900">{item.title}</p>
                    <p className="truncate text-xs text-zinc-600">{item.brand_label ?? "Marque"}</p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-zinc-800">
                      {guestCashRental ? (
                        <ItemWeeklyRentalPriceDisplay
                          pricePoints={item.price_points}
                          priceClassName="text-xs font-semibold text-zinc-800"
                          suffixClassName="text-[11px] font-normal text-zinc-600"
                        />
                      ) : (
                        `${(item.price_points ?? 0).toLocaleString("fr-FR")} crédits`
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                </Link>
                {canAdd ? (
                  <button
                    type="button"
                    aria-label={inCart ? "Retirer du panier" : "Ajouter au panier"}
                    disabled={busy}
                    onClick={() => void toggleCart(item.id)}
                    className={cn(
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-md ring-1 transition active:scale-[0.98] disabled:opacity-60",
                      inCart ? "bg-zinc-900 text-white ring-zinc-900/20" : "bg-white text-zinc-900 ring-zinc-200",
                    )}
                  >
                    <Plus className={cn("h-5 w-5", inCart && "rotate-45")} strokeWidth={2.2} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
