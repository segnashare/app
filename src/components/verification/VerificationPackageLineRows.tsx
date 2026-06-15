"use client";

import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";

import type { CommandeStyleOrderLine } from "@/components/commande/CommandeOrderLineRows";
import {
  INTAKE_FULFILLMENT_IN_VERIFICATION,
  INTAKE_FULFILLMENT_VERIFIED,
} from "@/lib/items/intake-fulfillment-stages";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import {
  ITEM_LIST_SQUARE_THUMB_FRAME_CLASS,
  itemSquareListThumbCoverProps,
} from "@/lib/items/item-photo-layout";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { cn } from "@/lib/utils/cn";

export type VerificationPackageLine = CommandeStyleOrderLine & {
  fulfillmentStage: typeof INTAKE_FULFILLMENT_IN_VERIFICATION | typeof INTAKE_FULFILLMENT_VERIFIED;
};

function splitNameAndBrand(name: string): { title: string; brand: string | null } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*)\(([^)]+)\)\s*$/);
  if (!match) return { title: trimmed, brand: null };
  return { title: match[1]?.trim() || trimmed, brand: match[2]?.trim() || null };
}

function verificationStatusPill(stage: VerificationPackageLine["fulfillmentStage"]): {
  label: string;
  className: string;
} {
  if (stage === INTAKE_FULFILLMENT_VERIFIED) {
    return { label: "Vérifiée", className: "bg-emerald-100 text-emerald-900" };
  }
  return { label: "En vérification", className: "bg-amber-100 text-amber-900" };
}

type VerificationPackageLineRowsProps = {
  lines: VerificationPackageLine[];
  creditKind: WalletCreditKind;
  itemHrefSuffix?: string;
  pointsUnitDisplay?: "label" | "icon";
};

export function VerificationPackageLineRows({
  lines,
  creditKind,
  itemHrefSuffix = "?from=verification",
  pointsUnitDisplay = "icon",
}: VerificationPackageLineRowsProps) {
  if (lines.length === 0) return null;

  return (
    <div className="-mx-5 divide-y divide-zinc-200">
      {lines.map((line) => {
        const pill = verificationStatusPill(line.fulfillmentStage);
        const { title, brand: brandFromName } = splitNameAndBrand(line.itemName);
        const brand = line.brand ?? brandFromName;

        return (
          <article
            key={line.id}
            className="relative grid w-full grid-cols-[100px_minmax(0,1fr)_auto] items-start gap-1 px-5 pb-3 pt-3 first:pt-1.5"
          >
            <Link
              href={`/items/${line.itemId}${itemHrefSuffix}`}
              aria-label={`Voir ${line.itemName}`}
              className="absolute inset-0 z-0"
            />

            <div className="pointer-events-none relative z-10 flex items-center self-center">
              {line.photoUrl ? (
                <RemoteCoverThumb
                  photoUrl={line.photoUrl}
                  frameClassName={ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}
                  {...itemSquareListThumbCoverProps({ photoPosition: line.photoPosition })}
                />
              ) : (
                <div
                  className={`flex items-center justify-center overflow-hidden rounded-md bg-zinc-200 text-zinc-400 ${ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}`}
                >
                  <ImageIcon className="h-7 w-7" aria-hidden />
                </div>
              )}
            </div>

            <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center justify-start px-1 py-0.5">
              <div className="min-w-0 flex-1">
                <div>
                  <p className="break-words text-[18px] font-semibold italic leading-[1.15] text-zinc-900">
                    {title}
                  </p>
                  {brand ? (
                    <span className="text-[16px] font-semibold not-italic text-zinc-900"> ({brand})</span>
                  ) : null}
                </div>
                {line.description ? (
                  <p
                    className="mt-1 line-clamp-1 min-w-0 text-[13px] leading-[1.3] text-zinc-500"
                    title={line.description}
                  >
                    {line.description}
                  </p>
                ) : null}
                <span
                  className={cn(
                    "mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                    pill.className,
                  )}
                >
                  {pill.label}
                </span>
              </div>
            </div>

            <div className="relative z-10 flex items-center justify-end self-center pl-1">
              <p className="pointer-events-none text-right tracking-tight text-zinc-900">
                <SegnaPointsUnitDisplay
                  points={line.pricePoints}
                  creditKind={creditKind}
                  unitDisplay={pointsUnitDisplay}
                  numberClassName="text-[15px] font-semibold text-zinc-900"
                />
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
