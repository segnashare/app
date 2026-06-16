import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";

/** Sous-titre délai carte checkout domicile. */
export function checkoutHomePlanEtaSubtitle(plan: CheckoutHomeMethodOption): string {
  if (plan.methodKey === "chronopost") {
    return "1 à 2 jours";
  }
  if (plan.methodKey === "domestic") {
    return "4 à 5 jours";
  }
  if (plan.deliveryEtaLabel?.trim()) {
    return plan.deliveryEtaLabel.trim().replace(/\s*ouvrés?\b/gi, "").trim();
  }
  return "Aller domicile · retour relais";
}
