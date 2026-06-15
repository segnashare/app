import { redirect } from "next/navigation";

/**
 * Ancienne étape interstitielle « Complétez votre tenue » (doublon du rail panier).
 * Le checkout va directement vers « Terminez votre commande » (/cart/upsell).
 */
export default function CartOutfitLegacyRedirectPage() {
  redirect("/cart/upsell");
}
