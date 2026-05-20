import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";

/** Sous-titre délai carte checkout domicile (Chrono 18). */
export function checkoutHomePlanEtaSubtitle(plan: CheckoutHomeMethodOption): string {
  if (plan.methodKey === "chronopost") {
    return "1 à 2 jours ouvrés";
  }
  if (plan.deliveryEtaLabel?.trim()) {
    return plan.deliveryEtaLabel.trim();
  }
  return "Aller domicile · retour relais";
}
