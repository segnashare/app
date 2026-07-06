import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import {
  hasOnboardingIncludedCreditsGrant,
  resolveOnboardingProcessForOfferVisibility,
} from "@/lib/onboarding/activate-included-credits";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import type { ShopPageLoadContext } from "@/lib/shop/load-shop-page-progressive";

export async function buildShopPageLoadContext(): Promise<ShopPageLoadContext | null> {
  const supabase = await createSupabaseServerClient();
  const { user } = await getCurrentAuthUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient() as Parameters<typeof hasOnboardingIncludedCreditsGrant>[0];
  const [userState, includedCreditsClaimed, membershipLabel] = await Promise.all([
    getCurrentUserAppState(user.id),
    hasOnboardingIncludedCreditsGrant(admin, user.id),
    resolveMembershipLabel(supabase, user.id),
  ]);

  const onboardingProcess = await resolveOnboardingProcessForOfferVisibility(
    admin,
    user.id,
    userState.onboarding_process ?? null,
    includedCreditsClaimed,
  );

  const isDemoMode = userState.onboarding_mode === "demo";
  const demoAdmin = isDemoMode ? createSupabaseDemoAdminClient() : null;
  const catalogDb = demoAdmin ?? supabase;

  return {
    userId: user.id,
    supabase,
    catalogDb,
    isDemoMode,
    onboardingProcess: onboardingProcess ?? null,
    includedCreditsClaimed,
    guideCartOnboarding: userState.onboarding_process === "panier",
    guestCashRental: isGuestCashRentalMode(membershipLabel),
  };
}
