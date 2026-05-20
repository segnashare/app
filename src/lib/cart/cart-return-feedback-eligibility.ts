import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";

/** Statuts retour à partir desquels le membre peut noter les pièces (retour initié / déposé). */
export function isCartReturnEligibleForItemFeedback(returnStatus: string | null | undefined): boolean {
  return isCartReturnCommitmentMet(returnStatus);
}
