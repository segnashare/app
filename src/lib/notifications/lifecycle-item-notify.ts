import type { SupabaseClient } from "@supabase/supabase-js";

import { itemEvaluatedEmail, itemReceivedBySegnaEmail, itemValidatedBySegnaEmail } from "@/lib/notifications/lifecycle-item-email";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";

export const memberLifecycleItemEventCodes = ["item_evaluated", "item_received_segna", "item_validated_segna"] as const;
export type MemberLifecycleItemEventCode = (typeof memberLifecycleItemEventCodes)[number];

function isMemberLifecycleItemEventCode(v: unknown): v is MemberLifecycleItemEventCode {
  return typeof v === "string" && (memberLifecycleItemEventCodes as readonly string[]).includes(v);
}

async function loadItemOwnerAndLabel(admin: SupabaseClient, itemId: string): Promise<{ userId: string; firstName: string | null; label: string } | null> {
  const { data: item, error } = await admin
    .from("items")
    .select("owner_user_id, title, brand")
    .eq("id", itemId)
    .maybeSingle();
  if (error || !item || typeof (item as { owner_user_id?: unknown }).owner_user_id !== "string") return null;
  const userId = (item as { owner_user_id: string }).owner_user_id;
  const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
  const brand = typeof (item as { brand?: unknown }).brand === "string" ? (item as { brand: string }).brand.trim() : "";
  const label = title || brand || `Pièce ${itemId.slice(0, 8)}…`;

  const { data: user } = await admin.from("users").select("first_name").eq("id", userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  return { userId, firstName, label };
}

/**
 * À appeler depuis `POST /api/internal/member-lifecycle/notify` (ou équivalent backoffice / n8n)
 * lorsqu’une étape pièce est atteinte hors flux `segna-app` direct.
 */
export async function dispatchMemberLifecycleItemEvent(
  admin: SupabaseClient,
  input: { itemId: string; event: MemberLifecycleItemEventCode },
): Promise<void> {
  if (!isMemberLifecycleItemEventCode(input.event)) return;

  const row = await loadItemOwnerAndLabel(admin, input.itemId);
  if (!row) return;

  const meta = { item_id: input.itemId, event: input.event };

  if (input.event === "item_evaluated") {
    const { subject, text, html } = itemEvaluatedEmail(row.firstName, row.label);
    await sendMemberOutreachNotification(admin, {
      userId: row.userId,
      kind: NotificationKind.itemListingEvaluated,
      idempotencyKey: `txn:lc:item:${input.itemId}:evaluated`,
      metadata: meta,
      subject,
      text,
      html,
      channels: "email",
    });
    return;
  }

  if (input.event === "item_received_segna") {
    const { subject, text, html } = itemReceivedBySegnaEmail(row.firstName, row.label);
    await sendMemberOutreachNotification(admin, {
      userId: row.userId,
      kind: NotificationKind.itemReceivedBySegna,
      idempotencyKey: `txn:lc:item:${input.itemId}:received_segna`,
      metadata: meta,
      subject,
      text,
      html,
      channels: "email",
    });
    return;
  }

  if (input.event === "item_validated_segna") {
    const { subject, text, html } = itemValidatedBySegnaEmail(row.firstName, row.label);
    await sendMemberOutreachNotification(admin, {
      userId: row.userId,
      kind: NotificationKind.itemValidatedBySegna,
      idempotencyKey: `txn:lc:item:${input.itemId}:validated_segna`,
      metadata: meta,
      subject,
      text,
      html,
      channels: "email",
    });
  }
}
