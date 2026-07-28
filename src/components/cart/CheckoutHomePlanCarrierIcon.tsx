import Image from "next/image";
import { Home } from "lucide-react";

import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";
import { resolveCheckoutCarrierLogoSrc } from "@/lib/sendcloud/checkout-carrier-logo";
import { cn } from "@/lib/utils/cn";

function isChronopostPlan(plan: CheckoutHomeMethodOption): boolean {
  return (
    plan.methodKey === "chronopost" ||
    plan.carrierCode.trim().toLowerCase() === "chronopost" ||
    plan.carrierName.trim().toLowerCase().includes("chronopost")
  );
}

type Props = {
  plan?: CheckoutHomeMethodOption;
  methodKey?: CheckoutHomeMethodOption["methodKey"];
  className?: string;
};

export function CheckoutHomePlanCarrierIcon({ plan, methodKey, className }: Props) {
  const resolvedMethodKey = plan?.methodKey ?? methodKey;
  const logoSrc = resolveCheckoutCarrierLogoSrc({
    methodKey: resolvedMethodKey,
    carrier:
      resolvedMethodKey === "chronopost" || (plan != null && isChronopostPlan(plan))
        ? "chronopost"
        : plan?.carrierCode,
    logoUrl: plan?.carrierLogoUrl,
  });

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
