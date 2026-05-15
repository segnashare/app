import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RequestBody = {
  email?: string;
  /**
   * `member` = membre Segna (`public.users`, après mot de passe / bootstrap).
   * `auth` = compte Supabase Auth (`auth.users`, OTP inclus) — connexion / reset.
   */
  mode?: "member" | "auth";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const email = (body.email ?? "").trim().toLowerCase();
    const mode: "member" | "auth" = body.mode === "member" ? "member" : "auth";

    if (!email) {
      return NextResponse.json({ exists: false }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    if (mode === "member") {
      const { data, error } = await admin.rpc("member_exists_by_email", { p_email: email });
      if (error) {
        return NextResponse.json({ exists: false }, { status: 500 });
      }
      return NextResponse.json({ exists: Boolean(data) });
    }

    const { data: lookup, error: lookupError } = await admin.rpc("auth_user_login_lookup_by_email", { p_email: email });
    if (lookupError) {
      console.error("[user-exists] auth_user_login_lookup_by_email", lookupError.message);
      return NextResponse.json({ exists: false }, { status: 500 });
    }

    const row = lookup as { exists?: boolean; passwordSet?: boolean; googleLinked?: boolean } | null;
    if (!row || row.exists !== true) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      passwordSet: Boolean(row.passwordSet),
      googleLinked: Boolean(row.googleLinked),
    });
  } catch {
    return NextResponse.json({ exists: false }, { status: 500 });
  }
}
