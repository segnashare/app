import Image from "next/image";

import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";
import { Home } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const CHRONOPOST_ICON_SRC = "/ressources/carriers/chronopost-icon.png";

function isChronopostPlan(plan: CheckoutHomeMethodOption): boolean {
  return (
    plan.methodKey === "chronopost" ||
    plan.carrierCode.trim().toLowerCase() === "chronopost" ||
    plan.carrierName.trim().toLowerCase().includes("chronopost")
  );
}

type Props = {
  plan: CheckoutHomeMethodOption;
  className?: string;
};

export function CheckoutHomePlanCarrierIcon({ plan, className }: Props) {
  const logoSrc = isChronopostPlan(plan) ? CHRONOPOST_ICON_SRC : plan.carrierLogoUrl?.trim() || null;

  if (logoSrc) {
    return (
      <Image
        src={logoSrc}
        alt=""
        width={20}
        height={20}
        className={cn("h-5 w-5 shrink-0 object-contain object-center", className)}
        unoptimized
      />
    );
  }

  return <Home className={cn("h-5 w-5 shrink-0 text-zinc-700", className)} aria-hidden />;
}
