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
    const rpcName = mode === "member" ? "member_exists_by_email" : "auth_user_exists_by_email";
    const { data, error } = await admin.rpc(rpcName, { p_email: email });

    if (error) {
      return NextResponse.json({ exists: false }, { status: 500 });
    }

    return NextResponse.json({ exists: Boolean(data) });
  } catch {
    return NextResponse.json({ exists: false }, { status: 500 });
  }
}
