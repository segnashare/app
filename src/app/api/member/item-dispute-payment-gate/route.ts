import { NextResponse } from "next/server";

import { fetchMemberItemDisputePaymentGate } from "@/lib/disputes/fetch-member-item-dispute-payment-gate";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

/** GET — litige pièce facturé non payé (blocage app + lien facture). */
export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const gate = await fetchMemberItemDisputePaymentGate(admin, user.id);
  if (process.env.NODE_ENV === "development") {
    console.info(
      "[item-dispute-payment-gate]",
      user.id.slice(0, 8),
      gate
        ? {
            itemDisputeId: gate.itemDisputeId,
            chargeStatus: gate.chargeStatus,
            billedPoints: gate.billedPoints,
            hasInvoice: Boolean(gate.stripeHostedInvoiceUrl),
          }
        : null,
    );
  }
  return NextResponse.json({ gate });
}
