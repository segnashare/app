import { NextResponse } from "next/server";

import { purgeMemberPersonalMedia } from "@/lib/profile/purge-member-personal-media";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

async function revokeAuthAccess(userId: string, accessToken: string | null) {
  const admin = createSupabaseAdminClient();
  const anonEmail = `deleted+${userId.replace(/-/g, "")}@segna.invalid`;

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email: anonEmail,
    phone: "",
    ban_duration: "876000h",
    user_metadata: {
      deleted: true,
      deleted_at: new Date().toISOString(),
    },
  });
  if (updateError) {
    console.error("[api/account/delete/request] auth anonymize", updateError.message);
  }

  if (accessToken) {
    const { error: signOutError } = await admin.auth.admin.signOut(accessToken, "global");
    if (signOutError) {
      console.error("[api/account/delete/request] auth signOut", signOutError.message);
    }
  }
}

export async function POST(request: Request) {
  const { user, error: userError, supabase } = (await resolveRequestUserClient(request)) as any;

  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "Non authentifié." }, { status: 401 });
  }

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;

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
      { ok: false as const, error: "Impossible de supprimer ton compte pour le moment." },
      { status: 500 },
    );
  }

  const payload = data as {
    ok?: boolean;
    blocked?: boolean;
    soft_deleted?: boolean;
    already_deleted?: boolean;
    request_id?: string;
    guard?: DeletionGuardPayload;
  } | null;

  const blocked = Boolean(payload?.blocked || payload?.guard?.blocked);
  const softDeleted = Boolean(payload?.soft_deleted) && !blocked;
  const blockers = payload?.guard?.blockers ?? {};

  if (softDeleted) {
    try {
      const admin = createSupabaseAdminClient();
      await purgeMemberPersonalMedia(admin, user.id);
    } catch (e) {
      console.error(
        "[api/account/delete/request] purge media",
        e instanceof Error ? e.message : e,
      );
    }
    try {
      await revokeAuthAccess(user.id, accessToken);
    } catch (e) {
      console.error(
        "[api/account/delete/request] revokeAuthAccess",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return NextResponse.json({
    ok: !blocked,
    blocked,
    softDeleted,
    alreadyDeleted: Boolean(payload?.already_deleted),
    requestId: payload?.request_id ?? null,
    blockers,
  });
}
