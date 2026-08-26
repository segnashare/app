import { NextResponse } from "next/server";

import { fetchMemberCheckoutDisputeBlock } from "@/lib/disputes/fetch-member-checkout-dispute-block";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

/** GET — litige ouvert bloque la réservation panier. */
export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const block = await fetchMemberCheckoutDisputeBlock(admin, user.id);
  return NextResponse.json({ block });
}
