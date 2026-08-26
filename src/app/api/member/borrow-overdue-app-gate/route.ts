import { NextResponse } from "next/server";

import { fetchMemberBorrowOverdueAppGate } from "@/lib/emprunt/fetch-member-borrow-overdue-app-gate";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

/** GET — retard emprunt J+1 (modale blocage app + historique / facture). */
export async function GET(request: Request) {
  const { user, error: userError, supabase } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const gate = await fetchMemberBorrowOverdueAppGate(supabase, user.id, Date.now(), {
    admin,
  });
  return NextResponse.json({ gate });
}
