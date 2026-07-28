"use client";

import Image from "next/image";

import {
  isCheckoutChronopostCarrier,
  isCheckoutMondialRelayCarrier,
  resolveCheckoutCarrierLogoSrc,
} from "@/lib/sendcloud/checkout-carrier-logo";
import { cn } from "@/lib/utils/cn";

type Props = {
  carrier?: string | null;
  /** URL logo Sendcloud (même champ que les plans domicile). */
  logoUrl?: string | null;
  className?: string;
  size?: number;
};

/** Logo transporteur — mêmes assets que les livraisons à domicile. */
export function SendcloudCarrierLogo({ carrier, logoUrl, className, size = 28 }: Props) {
  const src = resolveCheckoutCarrierLogoSrc({ carrier, logoUrl });
  const alt = isCheckoutMondialRelayCarrier(carrier)
    ? "Mondial Relay"
    : isCheckoutChronopostCarrier(carrier)
      ? "Chronopost"
      : "Transporteur";

  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={cn("shrink-0 object-contain object-center", className)}
        unoptimized
      />
    );
  }

  const initials = (carrier || "?").replace(/_/g, " ").slice(0, 2).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[5px] bg-[#1a2b56] text-[10px] font-bold uppercase leading-none text-white",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
