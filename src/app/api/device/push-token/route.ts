import { NextResponse } from "next/server";

import {
  deleteDevicePushTokenForUser,
  upsertDevicePushToken,
} from "@/lib/notifications/device-push-tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

function parsePlatform(raw: unknown): "ios" | "android" | null {
  if (raw === "ios" || raw === "android") return raw;
  return null;
}

export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);
  if (userError || !user) {
    return NextResponse.json({ message: "Session invalide." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    expoPushToken?: unknown;
    platform?: unknown;
    deviceId?: unknown;
    appVersion?: unknown;
  } | null;

  const expoPushToken = typeof body?.expoPushToken === "string" ? body.expoPushToken.trim() : "";
  const platform = parsePlatform(body?.platform);
  if (!expoPushToken || !platform) {
    return NextResponse.json({ message: "Jeton ou plateforme invalide." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient() as any;
  const result = await upsertDevicePushToken(admin, {
    userId: user.id,
    expoPushToken,
    platform,
    deviceId: typeof body?.deviceId === "string" ? body.deviceId : null,
    appVersion: typeof body?.appVersion === "string" ? body.appVersion : null,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true as const });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);
  if (userError || !user) {
    return NextResponse.json({ message: "Session invalide." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { expoPushToken?: unknown } | null;
  const expoPushToken = typeof body?.expoPushToken === "string" ? body.expoPushToken.trim() : null;

  const admin = createSupabaseAdminClient() as any;
  await deleteDevicePushTokenForUser(admin, { userId: user.id, expoPushToken });
  return NextResponse.json({ ok: true as const });
}
