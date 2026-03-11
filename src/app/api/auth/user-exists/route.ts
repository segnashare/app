import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RequestBody = {
  email?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const email = (body.email ?? "").trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ exists: false }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      return NextResponse.json({ exists: false }, { status: 500 });
    }

    const exists = data.users.some((user) => (user.email ?? "").toLowerCase() === email);
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false }, { status: 500 });
  }
}
