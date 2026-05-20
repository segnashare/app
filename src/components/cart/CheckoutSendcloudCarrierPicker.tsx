"use client";

import Image from "next/image";

import type { SendcloudOutboundDeliveryOptionRow } from "@/lib/cart/use-sendcloud-outbound-delivery-options";
import { centsToEuros } from "@/lib/shipping/exchange-shipping-pricing";
import { cn } from "@/lib/utils/cn";

type Props = {
  options: SendcloudOutboundDeliveryOptionRow[];
  selectedOptionCode: string | null;
  onSelect: (optionCode: string) => void;
  loading?: boolean;
  error?: string | null;
  weightTierLabel?: string | null;
  returnTtcCents?: number | null;
  className?: string;
};

function eurosTtc(cents: number | null): string {
  if (cents == null) return "—";
  return centsToEuros(cents).toFixed(2).replace(".", ",");
}

export function CheckoutSendcloudCarrierPicker({
  options,
  selectedOptionCode,
  onSelect,
  loading,
  error,
  weightTierLabel,
  returnTtcCents,
  className,
}: Props) {
  if (loading && options.length === 0) {
    return <p className={cn("text-[13px] text-zinc-500", className)}>Chargement des offres…</p>;
  }
  if (error) {
    return <p className={cn("text-[13px] text-red-700", className)}>{error}</p>;
  }
  if (options.length === 0) {
    return (
      <p className={cn("text-[13px] text-zinc-600", className)}>
        Aucune offre de livraison Sendcloud disponible pour ton code postal.
      </p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-[13px] font-medium text-zinc-700">
        Choisis ton mode de livraison
        {weightTierLabel ? (
          <span className="font-normal text-zinc-500"> · colis {weightTierLabel}</span>
        ) : null}
      </p>
      {returnTtcCents != null ? (
        <p className="text-[12px] leading-snug text-zinc-500">
          Retour point relais (tarif Sendcloud, selon poids) :{" "}
          <span className="font-semibold text-zinc-700">{eurosTtc(returnTtcCents)} € TTC</span>
        </p>
      ) : null}
      <ul className="grid gap-2" role="listbox" aria-label="Choisir une offre de livraison aller">
        {options.map((opt) => {
          const selected = selectedOptionCode === opt.optionCode;
          return (
            <li key={opt.optionCode}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(opt.optionCode)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                  selected ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                )}
              >
                {opt.carrierLogoUrl ? (
                  <Image
                    src={opt.carrierLogoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-100 text-[10px] font-bold uppercase text-zinc-600">
                    {(opt.carrierName || opt.carrierCode || "?").slice(0, 2)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-tight text-zinc-900">{opt.title}</span>
                  {opt.deliveryEtaLabel ? (
                    <span className="mt-0.5 block text-[12px] leading-snug text-zinc-500">{opt.deliveryEtaLabel}</span>
                  ) : null}
                  <span className="mt-0.5 block text-[11px] text-zinc-400">Aller + retour relais</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[14px] font-semibold tabular-nums text-zinc-900">
                    {opt.bundledRoundTripTtcCents != null ? (
                      <>
                        {eurosTtc(opt.bundledRoundTripTtcCents)}
                        <span className="ml-1 text-[11px] font-semibold text-zinc-500">€ TTC</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
