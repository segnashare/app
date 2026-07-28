"use client";

import type { CheckoutRelaySelection } from "@/lib/cart/checkout-delivery-storage";
import { formatSendcloudServicePointDistance } from "@/lib/sendcloud/format-service-point-hours";
import { formatCheckoutRelayDisplayLabel } from "@/lib/sendcloud/relay-point-ref";
import { cn } from "@/lib/utils/cn";

import { SendcloudCarrierLogo } from "@/components/cart/SendcloudCarrierLogo";

function splitRelayLabel(label: string): { name: string; street: string; cityLine: string } {
  const parts = formatCheckoutRelayDisplayLabel(label)
    .split(/\s*[—–]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    name: parts[0] ?? "Point relais",
    street: parts[1] ?? "",
    cityLine: parts[2] ?? "",
  };
}

type Props = {
  relay: CheckoutRelaySelection;
  /** Logo Sendcloud (même URL que les plans domicile). */
  carrierLogoUrl?: string | null;
  className?: string;
};

/**
 * Carte point relais calquée sur le widget Sendcloud Service Point Picker
 * (logo transporteur, nom, distance, adresse empilée, horaires).
 */
export function SendcloudRelayPointCard({ relay, carrierLogoUrl, className }: Props) {
  const fromLabel = splitRelayLabel(relay.label);
  const name = (relay.name?.trim() || fromLabel.name).toUpperCase();
  const street = (relay.street?.trim() || fromLabel.street).toUpperCase();
  const postal = (relay.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  const city = (relay.city?.trim() || fromLabel.cityLine.replace(/^\d{5}\s*/, "")).toUpperCase();
  const distance = formatSendcloudServicePointDistance(relay.distanceMeters);
  const hours = relay.hoursLabel?.trim() || null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[#e3e6eb] bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <div className="px-3.5 pb-3 pt-3.5">
        <div className="flex items-start gap-2.5">
          <SendcloudCarrierLogo
            carrier={relay.sendcloudCarrier}
            logoUrl={carrierLogoUrl}
            size={28}
            className="mt-0.5 h-7 w-7"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-[15px] font-bold uppercase leading-snug tracking-[-0.01em] text-[#1a2b56]">
                {name}
              </p>
              {distance ? (
                <p className="shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums text-[#3b5bdb]">
                  {distance}
                </p>
              ) : null}
            </div>
            <div className="mt-2 space-y-0.5 text-[13px] font-bold uppercase leading-tight text-zinc-950">
              {street ? <p className="m-0">{street}</p> : null}
              {postal ? <p className="m-0">{postal}</p> : null}
              {city ? <p className="m-0">{city}</p> : null}
            </div>
          </div>
        </div>
      </div>
      {hours ? (
        <div className="border-t border-[#e3e6eb] px-3.5 py-2.5">
          <p className="m-0 text-[13px] font-normal leading-snug text-zinc-950">{hours}</p>
        </div>
      ) : null}
    </div>
  );
}
