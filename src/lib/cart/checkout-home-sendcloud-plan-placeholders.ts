import type { CheckoutHomeMethodKey } from "@/lib/sendcloud/checkout-home-delivery-options";

export type CheckoutHomeSendcloudPlanPlaceholder = {
  methodKey: CheckoutHomeMethodKey;
  optionCode: string;
  title: string;
};

/** Cartes affichées pendant le devis Sendcloud domicile (avant réponse API). */
export const CHECKOUT_HOME_SENDCLOUD_LOADING_PLACEHOLDERS: CheckoutHomeSendcloudPlanPlaceholder[] = [
  { methodKey: "chronopost", optionCode: "__loading_chronopost__", title: "Chronopost" },
  { methodKey: "domestic", optionCode: "__loading_domestic__", title: "Livraison à domicile" },
];

export function checkoutHomePlanEtaSubtitleForMethodKey(methodKey: CheckoutHomeMethodKey): string {
  if (methodKey === "chronopost") return "1 à 2 jours";
  if (methodKey === "domestic") return "4 à 5 jours";
  return "Aller domicile · retour relais";
}
