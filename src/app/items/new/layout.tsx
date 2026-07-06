import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentAuthUser } from "@/lib/auth/current-user-server";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

import NewItemClientLayout from "./NewItemClientLayout";

export default async function NewItemLayout({ children }: { children: ReactNode }) {
  const { user } = await getCurrentAuthUser();
  if (user) {
    const supabase = await createSupabaseServerClient();
    const membershipLabel = await resolveMembershipLabel(supabase, user.id);
    if (isGuestCashRentalMode(membershipLabel)) {
      redirect("/package?plan=x");
    }
  }

  return <NewItemClientLayout>{children}</NewItemClientLayout>;
}
