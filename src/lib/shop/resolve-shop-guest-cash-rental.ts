import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

/** Guest : prix catalogue boutique en € (location / achat selon le mode panier). */
export async function resolveShopGuestCashRental(supabase: unknown, userId: string): Promise<boolean> {
  const membershipLabel = await resolveMembershipLabel(supabase, userId);
  return isGuestCashRentalMode(membershipLabel);
}
