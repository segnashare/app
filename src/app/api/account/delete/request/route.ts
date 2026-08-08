import { NextResponse } from "next/server";

import { resolveRequestUserClient } from "@/lib/supabase/request-user";

type DeletionGuardBlockers = {
  open_carts?: number;
  open_outbound_shipments?: number;
  open_return_shipments?: number;
  open_cart_items?: number;
};

type DeletionGuardPayload = {
  blocked?: boolean;
  blockers?: DeletionGuardBlockers;
};

export async function POST(request: Request) {
  const { user, error: userError, supabase } = (await resolveRequestUserClient(request)) as any;

  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "Non authentifié." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : null;

  const { data, error } = await supabase.rpc("request_my_account_deletion", {
    p_reason: reason && reason.length > 0 ? reason : null,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("NOT_AUTHENTICATED")) {
      return NextResponse.json({ ok: false as const, error: "Session invalide." }, { status: 401 });
    }
    console.error("[api/account/delete/request]", message);
    return NextResponse.json(
      { ok: false as const, error: "Impossible d'enregistrer ta demande pour le moment." },
      { status: 500 },
    );
  }

  const payload = data as {
    ok?: boolean;
    blocked?: boolean;
    request_id?: string;
    guard?: DeletionGuardPayload;
  } | null;

  const blocked = Boolean(payload?.blocked || payload?.guard?.blocked);
  const blockers = payload?.guard?.blockers ?? {};

  return NextResponse.json({
    ok: !blocked,
    blocked,
    requestId: payload?.request_id ?? null,
    blockers,
  });
}
