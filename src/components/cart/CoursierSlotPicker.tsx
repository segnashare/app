"use client";

import { useEffect, useMemo, useState } from "react";

import { formatCoursierOfferSlotButtonLabel } from "@/lib/coursier/format-offer-label";
import {
  coursierOfferSlotKey,
  findCoursierOfferBySlotKey,
  listCoursierSelectableOffers,
} from "@/lib/coursier/selectable-offers";
import type { CoursierGetPriceOffer } from "@/lib/coursier/types";
import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

type CoursierSlotPickerProps = {
  offers: CoursierGetPriceOffer[];
  selectedKey: string;
  onConfirm: (slotKey: string) => void;
  disabled?: boolean;
};

export function CoursierSlotPicker({
  offers,
  selectedKey,
  onConfirm,
  disabled = false,
}: CoursierSlotPickerProps) {
  const options = useMemo(() => listCoursierSelectableOffers(offers), [offers]);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(selectedKey);

  const selectedOffer = findCoursierOfferBySlotKey(options, selectedKey);
  const hasConfirmedSelection = selectedKey.trim() !== "" && selectedOffer != null;

  useEffect(() => {
    if (options.length !== 1) return;
    const key = coursierOfferSlotKey(options[0]!);
    if (selectedKey !== key) onConfirm(key);
  }, [onConfirm, options, selectedKey]);

  useEffect(() => {
    if (!modalOpen) return;
    const fallback = options[0] ? coursierOfferSlotKey(options[0]) : "";
    setDraftKey(selectedKey || fallback);
  }, [modalOpen, options, selectedKey]);

  if (options.length === 0) return null;

  const buttonLabel =
    hasConfirmedSelection && selectedOffer
      ? formatCoursierOfferSlotButtonLabel(selectedOffer)
      : "Choisir un créneau de livraison";

  return (
    <div className="flex w-full flex-col items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setModalOpen(true);
        }}
        className={cn(
          "mt-0.5 flex w-full max-w-[20rem] items-center justify-center rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-center text-[15px] font-bold shadow-sm transition",
          "hover:border-zinc-300 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-60",
          hasConfirmedSelection ? "text-zinc-900" : "text-zinc-700",
        )}
      >
        <span className="min-w-0">{buttonLabel}</span>
      </button>

      <SegnaAppBottomSheet open={modalOpen} onClose={() => setModalOpen(false)} zIndexClassName="z-[58]">
        <SegnaDialogSheetHandle />
        <p className={cn(segnaDialogTitleClass(), "text-[18px] sm:text-[20px]")}>
          Choisir un créneau de livraison
        </p>
        <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] text-zinc-500")}>
          Choisis l&apos;horaire de livraison à domicile.
        </p>

        <div className="mt-4 max-h-[min(52vh,420px)] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
          {options.map((offer) => {
            const key = coursierOfferSlotKey(offer);
            const picked = draftKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDraftKey(key)}
                className={cn(
                  "flex w-full items-center justify-center rounded-xl border-2 px-3 py-3 text-center transition",
                  picked ? "border-zinc-900" : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <span className="text-[14px] font-semibold leading-snug text-zinc-950">
                  {formatCoursierOfferSlotButtonLabel(offer)}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={!draftKey}
          onClick={() => {
            if (!draftKey) return;
            onConfirm(draftKey);
            setModalOpen(false);
          }}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-50"
        >
          Confirmer le créneau
        </button>
      </SegnaAppBottomSheet>
    </div>
  );
}
