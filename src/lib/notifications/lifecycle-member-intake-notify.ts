import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveMemberIntakeItemIds } from "@/lib/items/resolve-member-intake-item-ids";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";

type MemberIntakeNotifyItem = {
  itemId: string;
  userId: string;
  label: string;
  exchangeCredits: number | null;
};

function buildItemLabel(title: string, brand: string, itemId: string): string {
  const t = title.trim();
  const b = brand.trim();
  if (t) return t;
  if (b) return b;
  return `Pièce ${itemId.slice(0, 8)}…`;
}

function formatExchangeCreditsFragment(points: number | null): string {
  const n = points != null && Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  if (n <= 0) return "tu recevras tes crédits d'échange.";
  if (n === 1) return "tu recevras 1 crédit d'échange.";
  return `tu recevras tes ${n} crédits d'échange.`;
}

/** SMS membre : colis intake en route vers Segna (`member_intake` → `in_transit_out`). */
export function buildMemberIntakeDroppedInSms(label: string, exchangeCredits: number | null): string {
  const piece = label.trim() || "Ta pièce";
  const credits = formatExchangeCreditsFragment(exchangeCredits);
  return `Segna : ${piece} — elle rejoindra bientôt la collection après vérification et ${credits}`;
}

async function loadMemberIntakeNotifyItems(
  admin: SupabaseClient,
  shipmentId: string,
): Promise<MemberIntakeNotifyItem[]> {
  const itemIds = await resolveMemberIntakeItemIds(admin, shipmentId);
  if (!itemIds.length) return [];

  const { data: rows, error } = await admin
    .from("items")
    .select("id, owner_user_id, title, brand, price_points, deleted_at")
    .in("id", itemIds);
  if (error || !rows?.length) return [];

  const out: MemberIntakeNotifyItem[] = [];
  for (const row of rows) {
    if (row.deleted_at) continue;
    const itemId = String(row.id);
    const userId = typeof row.owner_user_id === "string" ? row.owner_user_id : "";
    if (!userId) continue;
    const title = typeof row.title === "string" ? row.title : "";
    const brand = typeof row.brand === "string" ? row.brand : "";
    const points =
      row.price_points != null && Number.isFinite(Number(row.price_points))
        ? Math.floor(Number(row.price_points))
        : null;
    out.push({
      itemId,
      userId,
      label: buildItemLabel(title, brand, itemId),
      exchangeCredits: points,
    });
  }
  return out;
}

/**
 * SMS transactionnel quand l’expédition membre → Segna passe en `in_transit_out`
 * (colis en route vers Segna après dépôt relais).
 */
export async function notifyMemberIntakeDroppedInAfterTransition(
  admin: SupabaseClient,
  input: { shipmentId: string; fromStatus: string; toStatus: string; source: string },
): Promise<void> {
  const to = String(input.toStatus ?? "").toLowerCase();
  const from = String(input.fromStatus ?? "").toLowerCase();
  if (to !== "in_transit_out" || from === "in_transit_out") return;

  const items = await loadMemberIntakeNotifyItems(admin, input.shipmentId);
  if (!items.length) return;

  for (const item of items) {
    await sendMemberSmsOnlyNotification(admin, {
      userId: item.userId,
      kind: NotificationKind.memberIntakeDroppedIn,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:member_intake_in_transit_out:${item.itemId}`,
      metadata: {
        shipment_id: input.shipmentId,
        item_id: item.itemId,
        from_status: input.fromStatus,
        to_status: input.toStatus,
        source: input.source,
        piece_label: item.label,
        exchange_credits: item.exchangeCredits,
      },
      smsBody: buildMemberIntakeDroppedInSms(item.label, item.exchangeCredits),
      transactionalSms: true,
    });
  }
}
