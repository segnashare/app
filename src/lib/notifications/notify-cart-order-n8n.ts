import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimNotificationSend,
  releaseNotificationSend,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";

export type CartOrderN8nNotifyResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error" | "cart_not_found"; detail?: string };

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Tolère un commentaire inline dans `.env` (ex. `https://…/webhook #prod`). */
function readCartOrderWebhookUrl(): string {
  const raw = process.env.N8N_CART_ORDER_WEBHOOK_URL?.trim() ?? "";
  if (!raw) return "";
  return raw.split("#")[0]?.trim() ?? "";
}

type CartOrderN8nItem = {
  cart_item_id: string;
  item_id: string;
  title: string;
  brand: string | null;
  price_points: number;
};

type CartOrderN8nPayload = {
  event: "cart_order_confirmed";
  cart_id: string;
  order_number_compact: string;
  user_id: string;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_phone: string | null;
  cart_status: string;
  created_at: string;
  confirmed_at: string;
  delivery_channel: "relay" | "home" | null;
  relay_point_id: string | null;
  delivery_line1: string | null;
  home_speed: string | null;
  sendcloud_order_number: string | null;
  sendcloud_panel_order_id: string | null;
  shipment_id: string | null;
  items: CartOrderN8nItem[];
  total_points: number;
};

async function loadCartOrderN8nPayload(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<CartOrderN8nPayload | null> {
  const [cartRes, userRes, linesRes, shipmentRes] = await Promise.all([
    admin
      .from("carts")
      .select("id, status, created_at, updated_at")
      .eq("id", input.cartId)
      .eq("user_id", input.userId)
      .is("deleted_at", null)
      .maybeSingle(),
    admin.from("users").select("email, first_name, last_name, phone").eq("id", input.userId).maybeSingle(),
    admin
      .from("cart_items")
      .select("id, item_id, items(title, price_points, item_custom_brand_label, item_brands(label))")
      .eq("cart_id", input.cartId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("shipments")
      .select("id, shipment_destinations(destination_type, provider_point_id, metadata)")
      .eq("cart_id", input.cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const cart = cartRes.data as { id: string; status: string; created_at: string; updated_at: string } | null;
  if (!cart) return null;

  const user = userRes.data as
    | {
        email?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        phone?: string | null;
      }
    | null;

  type ItemJoin = {
    title?: string | null;
    price_points?: number | null;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | null;
  };

  const lineRows = (linesRes.data ?? []) as {
    id: string;
    item_id: string;
    items: ItemJoin | null;
  }[];

  const items: CartOrderN8nItem[] = lineRows.map((row) => {
    const item = row.items;
    const brand =
      (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      (typeof item?.item_brands?.label === "string" && item.item_brands.label.trim()) ||
      null;
    return {
      cart_item_id: row.id,
      item_id: row.item_id,
      title: typeof item?.title === "string" ? item.title.trim() : "",
      brand,
      price_points: typeof item?.price_points === "number" ? item.price_points : 0,
    };
  });

  const totalPoints = items.reduce((sum, line) => sum + line.price_points, 0);

  const ship = shipmentRes.data as
    | {
        id: string;
        shipment_destinations?: Array<{
          destination_type?: string | null;
          provider_point_id?: string | null;
          metadata?: Record<string, unknown> | null;
        }> | null;
      }
    | null;

  const dest = ship?.shipment_destinations?.[0] ?? null;
  const destType = String(dest?.destination_type ?? "").toLowerCase();
  const deliveryChannel: CartOrderN8nPayload["delivery_channel"] =
    destType === "home" || destType.includes("domicile")
      ? "home"
      : destType
        ? "relay"
        : null;

  const destMeta = dest?.metadata && typeof dest.metadata === "object" ? dest.metadata : {};
  const relayPointId =
    (typeof dest?.provider_point_id === "string" && dest.provider_point_id.trim()) ||
    (typeof destMeta.relay_point_id === "string" && destMeta.relay_point_id.trim()) ||
    null;
  const deliveryLine1 =
    (typeof destMeta.delivery_line1 === "string" && destMeta.delivery_line1.trim()) || null;
  const homeSpeed = (typeof destMeta.home_speed === "string" && destMeta.home_speed.trim()) || null;

  const sendcloudOrderNumberFromMeta =
    typeof destMeta.sendcloud_order_number === "string" ? destMeta.sendcloud_order_number.trim() : "";
  const sendcloudOrderNumber =
    sendcloudOrderNumberFromMeta ||
    (ship?.id
      ? buildSendcloudOrderNumber({ cartId: input.cartId, shipmentId: ship.id, generation: 1 })
      : null);
  const sendcloudPanelOrderId =
    typeof destMeta.sendcloud_panel_order_id === "string" ? destMeta.sendcloud_panel_order_id.trim() : null;

  return {
    event: "cart_order_confirmed",
    cart_id: input.cartId,
    order_number_compact: formatOrderNumberCompact(input.cartId),
    user_id: input.userId,
    user_email: user?.email?.trim() ?? null,
    user_first_name: user?.first_name?.trim() ?? null,
    user_last_name: user?.last_name?.trim() ?? null,
    user_phone: user?.phone?.trim() ?? null,
    cart_status: cart.status,
    created_at: cart.created_at,
    confirmed_at: cart.updated_at,
    delivery_channel: deliveryChannel,
    relay_point_id: relayPointId,
    delivery_line1: deliveryLine1,
    home_speed: homeSpeed,
    sendcloud_order_number: sendcloudOrderNumber,
    sendcloud_panel_order_id: sendcloudPanelOrderId || null,
    shipment_id: ship?.id ?? null,
    items,
    total_points: totalPoints,
  };
}

async function postCartOrderN8nWebhook(payload: CartOrderN8nPayload): Promise<CartOrderN8nNotifyResult> {
  const url = readCartOrderWebhookUrl();
  if (!url) {
    console.error("[n8n/cart-order] N8N_CART_ORDER_WEBHOOK_URL is not set");
    return { ok: false, reason: "missing_url" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.N8N_CART_ORDER_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      console.warn("[n8n/cart-order] webhook HTTP", detail);
      return { ok: false, reason: "http_error", detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[n8n/cart-order] webhook failed", detail);
    return { ok: false, reason: "network_error", detail };
  }
}

/**
 * Déclare une commande panier confirmée vers n8n (`N8N_CART_ORDER_WEBHOOK_URL`).
 * Idempotent : une déclaration par `cart_id` (`notification_send_log`).
 */
export async function declareCartOrderToN8n(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<CartOrderN8nNotifyResult> {
  const idempotencyKey = `txn:cart_order_n8n:${input.cartId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.cartOrderN8nDeclared,
    userId: input.userId,
    metadata: { cart_id: input.cartId },
  });
  if (!claimed) {
    return { ok: true, skipped: true };
  }

  const payload = await loadCartOrderN8nPayload(admin, input);
  if (!payload) {
    await releaseNotificationSend(admin, idempotencyKey);
    return { ok: false, reason: "cart_not_found" };
  }

  const result = await postCartOrderN8nWebhook(payload);
  if (!result.ok) {
    await releaseNotificationSend(admin, idempotencyKey);
  }
  return result;
}
