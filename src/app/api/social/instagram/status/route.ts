import { NextResponse } from "next/server";

import { fetchInstagramMedia } from "@/lib/social/instagram";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type StoredInstagramData = {
  connected?: boolean;
  username?: string;
  account_type?: string;
  media_count?: number;
  access_token?: string;
  token_expires_at?: string | null;
  updated_at?: string;
};

type SupabaseStatusClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  from: (table: string) => {
    select: (query: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

function readStoredInstagramData(row: Record<string, unknown> | null | undefined): StoredInstagramData {
  if (!row || typeof row !== "object") return {};
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const instagramData = (profileData.instagram ?? {}) as Record<string, unknown>;
  return {
    connected: instagramData.connected === true,
    username: typeof instagramData.username === "string" ? instagramData.username : undefined,
    account_type: typeof instagramData.account_type === "string" ? instagramData.account_type : undefined,
    media_count: typeof instagramData.media_count === "number" ? instagramData.media_count : undefined,
    access_token: typeof instagramData.access_token === "string" ? instagramData.access_token : undefined,
    token_expires_at: typeof instagramData.token_expires_at === "string" ? instagramData.token_expires_at : null,
    updated_at: typeof instagramData.updated_at === "string" ? instagramData.updated_at : undefined,
  };
}

export async function GET() {
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseStatusClient;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ connected: false }, { status: 401 });
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("user_profiles")
      .select("profile_data")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ connected: false }, { status: 500 });
    }

    const stored = readStoredInstagramData(profileRow as Record<string, unknown> | null | undefined);
    if (!stored.connected || !stored.access_token) {
      return NextResponse.json({ connected: false });
    }

    const media = await fetchInstagramMedia(stored.access_token, 6);
    return NextResponse.json({
      connected: true,
      username: stored.username ?? null,
      accountType: stored.account_type ?? null,
      mediaCount: typeof stored.media_count === "number" ? stored.media_count : null,
      tokenExpiresAt: stored.token_expires_at ?? null,
      syncedAt: stored.updated_at ?? null,
      media,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        connected: true,
        media: [],
        warning: message,
      },
      { status: 200 },
    );
  }
}
