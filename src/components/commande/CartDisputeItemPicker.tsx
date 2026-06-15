"use client";

import { Image as ImageIcon, Check } from "lucide-react";

import type { MemberCartOrderLine } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  ITEM_LIST_SQUARE_THUMB_FRAME_CLASS,
  itemSquareListThumbCoverProps,
} from "@/lib/items/item-photo-layout";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  lines: MemberCartOrderLine[];
  selectedItemIds: string[];
  onChange: (itemIds: string[]) => void;
};

function checkBoxClass(active: boolean) {
  return cn(
    "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center border",
    active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-zinc-100 text-transparent",
  );
}

export function CartDisputeItemPicker({ lines, selectedItemIds, onChange }: Props) {
  const allIds = lines.map((l) => l.itemId);
  const allSelected = allIds.length > 0 && selectedItemIds.length === allIds.length;

  function toggle(itemId: string) {
    onChange(
      selectedItemIds.includes(itemId)
        ? selectedItemIds.filter((id) => id !== itemId)
        : [...selectedItemIds, itemId],
    );
  }

  if (lines.length === 0) {
    return <p className={cn(segnaMontserrat.className, "text-sm text-zinc-500")}>Aucun article sur cette commande.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={cn(segnaMontserrat.className, "text-[13px] text-zinc-500")}>
          {selectedItemIds.length} / {lines.length} article{lines.length !== 1 ? "s" : ""} sélectionné
          {selectedItemIds.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : allIds)}
          className={cn(segnaMontserrat.className, "text-[13px] font-semibold text-zinc-700 underline underline-offset-2")}
        >
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
      </div>

      <div className="-mx-5 divide-y divide-zinc-200 border-y border-zinc-200">
        {lines.map((line) => {
          const active = selectedItemIds.includes(line.itemId);
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => toggle(line.itemId)}
              className="grid w-full grid-cols-[100px_minmax(0,1fr)_auto] items-center gap-1 px-5 py-3 text-left transition hover:bg-zinc-50"
            >
              {line.photoUrl ? (
                <RemoteCoverThumb
                  photoUrl={line.photoUrl}
                  frameClassName={ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}
                  {...itemSquareListThumbCoverProps({ photoPosition: line.photoPosition })}
                />
              ) : (
                <div
                  className={`flex items-center justify-center rounded-md bg-zinc-200 text-zinc-400 ${ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}`}
                >
                  <ImageIcon className="h-7 w-7" aria-hidden />
                </div>
              )}

              <div className="min-w-0 px-1">
                <p className="break-words text-[18px] font-semibold italic leading-[1.15] text-zinc-900">
                  {line.itemName}
                </p>
                {line.brand ? (
                  <span className="text-[16px] font-semibold not-italic text-zinc-900"> ({line.brand})</span>
                ) : null}
                {line.description ? (
                  <p className="mt-1 line-clamp-1 text-[13px] leading-[1.3] text-zinc-500">{line.description}</p>
                ) : null}
              </div>

              <span className={checkBoxClass(active)} aria-hidden>
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
