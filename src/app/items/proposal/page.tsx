import { redirect } from "next/navigation";

import { ItemProposalInfoPageClient } from "@/app/items/proposal/ItemProposalInfoPageClient";
import { getCurrentAuthUser } from "@/lib/auth/current-user-server";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

export default async function ItemProposalInfoPage() {
  const { user } = await getCurrentAuthUser();
  if (user) {
    const supabase = await createSupabaseServerClient();
    const membershipLabel = await resolveMembershipLabel(supabase, user.id);
    if (isGuestCashRentalMode(membershipLabel)) {
      redirect("/package?plan=x");
    }
  }

  return <ItemProposalInfoPageClient />;
}
