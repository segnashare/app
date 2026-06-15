import type { SupabaseClient } from "@supabase/supabase-js";

import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";

type PriceChangeRow = {
  item_id: string;
  old_price_points: number | null;
  new_price_points: number;
  metadata: Record<string, unknown> | null;
};

type ActiveCartRow = {
  cart_id: string;
  user_id: string;
  item_id: string;
  item_title: string;
  old_price_points: number;
  new_price_points: number;
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.SEGNA_APP_URL?.trim() ||
    "https://app.segnashare.com"
  );
}

async function notifyItemOwnerExchangeChange(
  admin: SupabaseClient,
  input: {
    ownerUserId: string;
    itemId: string;
    itemTitle: string;
    oldPoints: number;
    newPoints: number;
    dayKey: string;
  },
): Promise<void> {
  const delta = input.newPoints - input.oldPoints;
  const direction = delta > 0 ? "augmenté" : "diminué";
  const subject =
    delta > 0
      ? `Ta pièce « ${input.itemTitle} » est très demandée`
      : `Mise à jour de la valeur d'échange de ta pièce`;

  const text = `Bonjour,\n\nLa valeur d'échange de ta pièce « ${input.itemTitle} » a ${direction} de ${input.oldPoints} à ${input.newPoints} points Segna, en fonction de la demande dans le dressing partagé.\n\nTa valeur de remplacement (garantie) reste inchangée.\n\nVoir le détail : ${appBaseUrl()}/items/${input.itemId}/evaluation`;

  const html = `<p>Bonjour,</p><p>La valeur d&apos;échange de ta pièce <strong>${input.itemTitle}</strong> a ${direction} de <strong>${input.oldPoints}</strong> à <strong>${input.newPoints}</strong> points Segna, en fonction de la demande dans le dressing partagé.</p><p>Ta valeur de remplacement (garantie) reste inchangée.</p><p><a href="${appBaseUrl()}/items/${input.itemId}/evaluation">Voir le détail</a></p>`;

  await sendMemberOutreachNotification(admin, {
    userId: input.ownerUserId,
    kind: NotificationKind.itemExchangePriceChanged,
    idempotencyKey: `item_exchange_price_changed:owner:${input.itemId}:${input.dayKey}:${input.newPoints}`,
    metadata: {
      item_id: input.itemId,
      old_price_points: input.oldPoints,
      new_price_points: input.newPoints,
    },
    subject,
    text,
    html,
    channels: "email",
  });
}

async function notifyBorrowerCartPriceChange(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    itemTitle: string;
    oldPoints: number;
    newPoints: number;
    dayKey: string;
  },
): Promise<void> {
  const subject = `Mise à jour du panier : ${input.itemTitle}`;
  const text = `Bonjour,\n\nLe prix d'échange de « ${input.itemTitle} » dans ton panier a évolué (${input.oldPoints} → ${input.newPoints} pts). Ouvre ton panier pour voir le total actualisé.\n\n${appBaseUrl()}/cart`;

  const html = `<p>Bonjour,</p><p>Le prix d&apos;échange de <strong>${input.itemTitle}</strong> dans ton panier a évolué (<strong>${input.oldPoints}</strong> → <strong>${input.newPoints}</strong> pts).</p><p><a href="${appBaseUrl()}/cart">Voir mon panier</a></p>`;

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.cartExchangePriceChanged,
    idempotencyKey: `cart_exchange_price_changed:${input.cartId}:${input.itemTitle}:${input.dayKey}:${input.newPoints}`,
    metadata: {
      cart_id: input.cartId,
      old_price_points: input.oldPoints,
      new_price_points: input.newPoints,
    },
    subject,
    text,
    html,
    channels: "email",
  });
}

export async function notifyExchangePriceChanges(
  admin: SupabaseClient,
  changes: PriceChangeRow[],
  dayKey: string,
): Promise<{ ownersNotified: number; borrowersNotified: number }> {
  if (changes.length === 0) return { ownersNotified: 0, borrowersNotified: 0 };

  const itemIds = changes.map((c) => c.item_id);
  const { data: itemsRaw } = await admin
    .from("items")
    .select("id, title, owner_user_id")
    .in("id", itemIds);

  const itemById = new Map(
    (itemsRaw ?? []).map((row) => [
      String(row.id),
      {
        title: typeof row.title === "string" ? row.title : "Ta pièce",
        ownerUserId: String(row.owner_user_id ?? ""),
      },
    ]),
  );

  let ownersNotified = 0;
  for (const change of changes) {
    const item = itemById.get(change.item_id);
    if (!item?.ownerUserId) continue;
    const oldPts = change.old_price_points ?? change.new_price_points;
    await notifyItemOwnerExchangeChange(admin, {
      ownerUserId: item.ownerUserId,
      itemId: change.item_id,
      itemTitle: item.title,
      oldPoints: oldPts,
      newPoints: change.new_price_points,
      dayKey,
    });
    ownersNotified += 1;
  }

  const changesJson = changes.map((c) => ({
    item_id: c.item_id,
    old_price_points: c.old_price_points ?? c.new_price_points,
    new_price_points: c.new_price_points,
  }));

  const { data: cartRows, error: cartErr } = await admin.rpc("list_active_carts_for_exchange_price_changes", {
    p_changes: changesJson,
  });

  if (cartErr) {
    console.warn("[economy] list_active_carts_for_exchange_price_changes", cartErr.message);
    return { ownersNotified, borrowersNotified: 0 };
  }

  const notifiedBorrowers = new Set<string>();
  let borrowersNotified = 0;
  for (const row of (cartRows ?? []) as ActiveCartRow[]) {
    const dedupeKey = `${row.cart_id}:${row.user_id}:${row.item_id}:${row.new_price_points}`;
    if (notifiedBorrowers.has(dedupeKey)) continue;
    notifiedBorrowers.add(dedupeKey);
    await notifyBorrowerCartPriceChange(admin, {
      userId: row.user_id,
      cartId: row.cart_id,
      itemTitle: row.item_title,
      oldPoints: row.old_price_points,
      newPoints: row.new_price_points,
      dayKey,
    });
    borrowersNotified += 1;
  }

  return { ownersNotified, borrowersNotified };
}
