import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseDisconnectClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }>;
};

export async function POST() {
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseDisconnectClient;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const { error: updateError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        profile_data: {
          instagram: {
            connected: false,
            provider_user_id: null,
            username: null,
            account_type: null,
            media_count: null,
            access_token: null,
            token_expires_at: null,
            updated_at: new Date().toISOString(),
          },
        },
      },
      p_request_id: crypto.randomUUID(),
    });

    if (updateError) {
      return NextResponse.json({ ok: false, message: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
