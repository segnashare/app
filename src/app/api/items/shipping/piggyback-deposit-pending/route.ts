import { NextResponse } from "next/server";

import { fetchMemberPiggybackDepositConfirmQueue } from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Service indisponible" }, { status: 503 });
  }

  const queue = await fetchMemberPiggybackDepositConfirmQueue(admin, user.id);
  return NextResponse.json({
    ok: true as const,
    pending: queue.length > 0,
    queue,
  });
}
