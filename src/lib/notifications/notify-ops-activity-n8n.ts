import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimNotificationSend,
  releaseNotificationSend,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  postOpsActivityN8nWebhook,
  type OpsActivityN8nResult,
} from "@/lib/notifications/n8n-ops-activity-webhook";

export type OpsActivityN8nNotifyResult =
  | { ok: true; skipped?: boolean }
  | OpsActivityN8nResult
  | { ok: false; reason: "user_not_found"; detail?: string };

type UserContact = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

async function loadUserContact(admin: SupabaseClient, userId: string): Promise<UserContact | null> {
  const { data, error } = await admin
    .from("users")
    .select("email, first_name, last_name, phone")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[n8n/ops-activity] loadUserContact", error.message);
    return null;
  }
  return data as UserContact | null;
}

function userFields(user: UserContact | null) {
  return {
    user_email: user?.email?.trim() ?? null,
    user_first_name: user?.first_name?.trim() ?? null,
    user_last_name: user?.last_name?.trim() ?? null,
    user_phone: user?.phone?.trim() ?? null,
  };
}

/**
 * Nouveau compte membre réel (`public.users` via bootstrap).
 * Idempotent : une déclaration par `user_id`.
 */
export async function declareUserRegisteredToN8n(
  admin: SupabaseClient,
  input: { userId: string; source?: string },
): Promise<OpsActivityN8nNotifyResult> {
  const idempotencyKey = `txn:user_registered_n8n:${input.userId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.userRegisteredN8nDeclared,
    userId: input.userId,
    metadata: { source: input.source ?? null },
  });
  if (!claimed) {
    return { ok: true, skipped: true };
  }

  const user = await loadUserContact(admin, input.userId);
  if (!user) {
    await releaseNotificationSend(admin, idempotencyKey);
    return { ok: false, reason: "user_not_found" };
  }

  const result = await postOpsActivityN8nWebhook(
    {
      event: "user_registered",
      user_id: input.userId,
      ...userFields(user),
      source: input.source ?? null,
      registered_at: new Date().toISOString(),
    },
    "user-registered",
  );
  if (!result.ok) {
    await releaseNotificationSend(admin, idempotencyKey);
  }
  return result;
}
