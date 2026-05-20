import type { SupabaseClient } from "@supabase/supabase-js";

import { itemEvaluatedEmail, itemReceivedBySegnaEmail, itemValidatedBySegnaEmail } from "@/lib/notifications/lifecycle-item-email";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberOutreachNotification, sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";

export const memberLifecycleItemEventCodes = [
  "item_evaluated",
  "item_received_segna",
  "item_validated_segna",
  "item_intake_verified",
] as const;
export type MemberLifecycleItemEventCode = (typeof memberLifecycleItemEventCodes)[number];

function isMemberLifecycleItemEventCode(v: unknown): v is MemberLifecycleItemEventCode {
  return typeof v === "string" && (memberLifecycleItemEventCodes as readonly string[]).includes(v);
}

function buildItemLabel(title: string, brand: string, itemId: string): string {
  const t = title.trim();
  const b = brand.trim();
  if (t) return t;
  if (b) return b;
  return `Pièce ${itemId.slice(0, 8)}…`;
}

function formatExchangeCreditsCreditedFragment(points: number | null): string {
  const n = points != null && Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  if (n <= 0) return "Tu as été crédité de tes crédits d'échange.";
  if (n === 1) return "Tu as été crédité de 1 crédit d'échange.";
  return `Tu as été crédité de ${n} crédits d'échange.`;
}

/** SMS : vérification physique OK + crédits d’échange (clic BO section Vérification). */
export function buildItemIntakeVerifiedSms(label: string, exchangeCredits: number | null): string {
  const piece = label.trim() || "Ta pièce";
  const credits = formatExchangeCreditsCreditedFragment(exchangeCredits);
  return [
    `Segna : Nous avons vérifié ${piece}, elle est bien conforme à nos attentes.`,
    "Elle intègre le dressing partagé, pour le plus grand plaisir des autres membres !",
    `${credits} Profite-en bien.`,
  ].join("\n");
}

async function loadItemOwnerAndLabel(admin: SupabaseClient, itemId: string): Promise<{ userId: string; firstName: string | null; label: string } | null> {
  const row = await loadItemOwnerLabelAndCredits(admin, itemId);
  if (!row) return null;
  const { data: user } = await admin.from("users").select("first_name").eq("id", row.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  return { userId: row.userId, firstName, label: row.label };
}

async function loadItemOwnerLabelAndCredits(
  admin: SupabaseClient,
  itemId: string,
): Promise<{ userId: string; label: string; exchangeCredits: number | null } | null> {
  const { data: item, error } = await admin
    .from("items")
    .select("owner_user_id, title, item_brand_id, price_points, deleted_at")
    .eq("id", itemId)
    .maybeSingle();
  if (error || !item || item.deleted_at) return null;
  if (typeof (item as { owner_user_id?: unknown }).owner_user_id !== "string") return null;
  const userId = (item as { owner_user_id: string }).owner_user_id;
  const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
  let brand = "";
  const brandId = (item as { item_brand_id?: string | null }).item_brand_id;
  if (brandId) {
    const { data: brandRow } = await admin.from("item_brands").select("label").eq("id", brandId).maybeSingle();
    brand = typeof brandRow?.label === "string" ? brandRow.label.trim() : "";
  }
  const label = buildItemLabel(title, brand, itemId);
  const points =
    item.price_points != null && Number.isFinite(Number(item.price_points))
      ? Math.floor(Number(item.price_points))
      : null;
  return { userId, label, exchangeCredits: points };
}

/** SMS transactionnel après passage intake en `verified` (listing `validated`). */
export async function notifyItemIntakeVerifiedSms(
  admin: SupabaseClient,
  input: { itemId: string; source: string },
): Promise<void> {
  const row = await loadItemOwnerLabelAndCredits(admin, input.itemId);
  if (!row) return;

  await sendMemberSmsOnlyNotification(admin, {
    userId: row.userId,
    kind: NotificationKind.itemIntakeVerified,
    idempotencyKey: `txn:lc:item:${input.itemId}:intake_verified_sms`,
    metadata: {
      item_id: input.itemId,
      event: "item_intake_verified",
      source: input.source,
      piece_label: row.label,
      exchange_credits: row.exchangeCredits,
    },
    smsBody: buildItemIntakeVerifiedSms(row.label, row.exchangeCredits),
    transactionalSms: true,
  });
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
    return;
  }

  if (input.event === "item_intake_verified") {
    await notifyItemIntakeVerifiedSms(admin, { itemId: input.itemId, source: "member_lifecycle_api" });
  }
}
