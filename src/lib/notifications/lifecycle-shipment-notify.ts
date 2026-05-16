import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeOutboundShipmentStatusForUi } from "@/lib/cart/member-outbound-shipment-copy";
import { loadCartUsesUberHomeDelivery } from "@/lib/cart/load-cart-uber-home-delivery";
import { getSegnaSupportContact } from "@/lib/config/support-contact";
import type { BorrowReturnReminderPhase } from "@/lib/emprunt/borrow-return-reminder-buckets";
import {
  computeBorrowDeadlineMs,
  describeBorrowPeriodForMembership,
  resolveOutboundBorrowDeliveredAtIso,
  type SegnaBorrowMembershipLabel,
} from "@/lib/emprunt/borrow-period";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  borrowDeadlineReminderEmail,
  orderOutboundDeliveredEmail,
  orderOutboundRelayPickupAvailableEmail,
  returnDroppedOutEmail,
  returnReceivedBySegnaEmail,
} from "@/lib/notifications/lifecycle-shipment-email";
import { sendMemberOutreachNotification, sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

const SMS_OUTBOUND_READY =
  "Segna : ton colis est prêt à partir. Les prochaines étapes arrivent dans l’app Segna.";
/** `dropped_in` : pris en charge par le partenaire — pas encore retirable au relais. */
const SMS_OUTBOUND_TRANSIT_PARTNER =
  "Segna : ton colis est en transit chez le partenaire — pas encore prêt au retrait. Suis l’envoi via le partenaire (lien dans l’app Segna).";
/** `dropped_out` (aller) : disponible pour retrait au point relais. */
const SMS_OUTBOUND_RELAY_AVAILABLE =
  "Segna : ton colis est disponible au point relais. Tu peux le retirer — détail et suivi dans l’app.";
/** `delivered` (aller, depuis transit) : livraison confirmée — e-mail récap + SMS. */
const SMS_OUTBOUND_DELIVERED =
  "Segna : ton colis devrait être chez toi. Profite bien de ta box ! Signale le moindre problème dans l’app. Bon échange !";
const SMS_RETURN_AT_RELAY = "Segna : ton retour au relais est enregistré. Merci !";

type CartItemJoinForNotify = {
  title?: string | null;
  item_custom_brand_label?: string | null;
  item_brands?: { label?: string | null } | null;
} | null;

function formatReturnDeadlineForEmail(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isOutboundDeliveredFromInTransit(fromStatus: string): boolean {
  const f = normalizeOutboundShipmentStatusForUi(fromStatus);
  return f === "in_transit_in" || f === "in_transit_out";
}

async function loadCartOrderItemLabels(admin: SupabaseClient, cartId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("cart_items")
    .select("items(title, item_custom_brand_label, item_brands(label))")
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[notifications] loadCartOrderItemLabels", error.message);
    return [];
  }

  const rows = (data ?? []) as { items: CartItemJoinForNotify }[];
  return rows.map((row) => {
    const item = row.items;
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const brand =
      (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      (typeof item?.item_brands?.label === "string" && item.item_brands.label.trim()) ||
      "";
    if (title && brand) return `${title} (${brand})`;
    if (title) return title;
    if (brand) return brand;
    return "Pièce";
  });
}

async function loadOutboundDeliveredNotificationContext(
  admin: SupabaseClient,
  cartId: string,
  userId: string,
  shipmentId: string,
): Promise<{
  itemLabels: string[];
  membershipLabel: SegnaBorrowMembershipLabel;
  returnDeadlineLabel: string;
  borrowPeriodLabel: string;
  orderRef: string;
} | null> {
  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("delivered_at, updated_at")
    .eq("id", shipmentId)
    .maybeSingle();
  if (shipErr) {
    console.error("[notifications] loadOutboundDeliveredNotificationContext shipment", shipErr.message);
    return null;
  }

  const deliveredIso = resolveOutboundBorrowDeliveredAtIso(
    (ship as { delivered_at?: string | null } | null)?.delivered_at,
    (ship as { updated_at?: string | null } | null)?.updated_at,
  );
  const deliveredAtMs = deliveredIso ? Date.parse(deliveredIso) : Date.now();
  if (!Number.isFinite(deliveredAtMs)) return null;

  const membership = (await resolveMembershipLabelForServiceRole(admin, userId)) as SegnaBorrowMembershipLabel;
  const deadlineMs = computeBorrowDeadlineMs(deliveredAtMs, membership);
  if (!Number.isFinite(deadlineMs)) return null;

  const itemLabels = await loadCartOrderItemLabels(admin, cartId);
  const orderRef = cartId.slice(0, 8).toUpperCase();

  return {
    itemLabels,
    membershipLabel: membership,
    borrowPeriodLabel: describeBorrowPeriodForMembership(membership),
    returnDeadlineLabel: formatReturnDeadlineForEmail(deadlineMs),
    orderRef,
  };
}

async function loadCartMember(admin: SupabaseClient, shipmentId: string): Promise<{ userId: string; firstName: string | null } | null> {
  const { data: ship, error: sErr } = await admin.from("shipments").select("cart_id, context").eq("id", shipmentId).maybeSingle();
  if (sErr || !ship || typeof (ship as { cart_id?: unknown }).cart_id !== "string") return null;
  const cartId = (ship as { cart_id: string }).cart_id;

  const { data: cart, error: cErr } = await admin.from("carts").select("user_id").eq("id", cartId).maybeSingle();
  if (cErr || !cart || typeof (cart as { user_id?: unknown }).user_id !== "string") return null;
  const userId = (cart as { user_id: string }).user_id;

  const { data: user } = await admin.from("users").select("first_name").eq("id", userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  return { userId, firstName };
}

/**
 * Notifications membre après transition réussie (`transition_shipment_status`).
 * Aller : `ready` (pending → ready) → SMS seul ; `dropped_in` → SMS seul (transit partenaire) ; `dropped_out` → e-mail + SMS (dispo au relais), sauf Uber domicile ; `delivered` (depuis transit) → e-mail récap + SMS.
 */
export async function notifyShipmentLifecycleAfterTransition(
  admin: SupabaseClient,
  input: { shipmentId: string; fromStatus: string; toStatus: string; source: string },
): Promise<void> {
  const { data: ship, error } = await admin
    .from("shipments")
    .select("id, cart_id, context")
    .eq("id", input.shipmentId)
    .maybeSingle();
  if (error || !ship) return;

  const context = String((ship as { context?: unknown }).context ?? "");
  const to = String(input.toStatus ?? "").toLowerCase();
  const from = String(input.fromStatus ?? "").toLowerCase();
  const cartId = (ship as { cart_id: string }).cart_id;

  const member = await loadCartMember(admin, input.shipmentId);
  if (!member) return;

  const meta = {
    shipment_id: input.shipmentId,
    cart_id: cartId,
    context,
    from_status: input.fromStatus,
    to_status: input.toStatus,
    source: input.source,
  };

  if (context === "cart_outbound" && to === "ready" && from === "pending") {
    await sendMemberSmsOnlyNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundReadyToShip,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:ready`,
      metadata: { ...meta, pending_to_ready: true },
      smsBody: SMS_OUTBOUND_READY,
      transactionalSms: true,
    });
    return;
  }

  if (context === "cart_outbound" && to === "dropped_in") {
    const uberHome = await loadCartUsesUberHomeDelivery(admin, cartId);
    if (uberHome) return;

    await sendMemberSmsOnlyNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundTransitPartner,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:dropped_in_transit_sms`,
      metadata: meta,
      smsBody: SMS_OUTBOUND_TRANSIT_PARTNER,
      transactionalSms: true,
    });
    return;
  }

  if (context === "cart_outbound" && to === "dropped_out") {
    const uberHome = await loadCartUsesUberHomeDelivery(admin, cartId);
    if (uberHome) return;

    const { subject, text, html } = orderOutboundRelayPickupAvailableEmail(member.firstName);
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundRelayPickupReady,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:outbound_relay_available`,
      metadata: meta,
      subject,
      text,
      html,
      channels: "email+phone",
      smsBody: SMS_OUTBOUND_RELAY_AVAILABLE,
      transactionalSms: true,
    });
    return;
  }

  if (context === "cart_outbound" && to === "delivered" && isOutboundDeliveredFromInTransit(from)) {
    const deliveredCtx = await loadOutboundDeliveredNotificationContext(
      admin,
      cartId,
      member.userId,
      input.shipmentId,
    );
    if (!deliveredCtx) return;

    const supportEmail = getSegnaSupportContact().email ?? "contact@segnashare.com";
    const { subject, text, html } = orderOutboundDeliveredEmail({
      firstName: member.firstName,
      orderRef: deliveredCtx.orderRef,
      itemLabels: deliveredCtx.itemLabels,
      borrowPeriodLabel: deliveredCtx.borrowPeriodLabel,
      returnDeadlineLabel: deliveredCtx.returnDeadlineLabel,
      supportEmail,
    });
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundDelivered,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:delivered`,
      metadata: {
        ...meta,
        membership: deliveredCtx.membershipLabel,
        return_deadline: deliveredCtx.returnDeadlineLabel,
      },
      subject,
      text,
      html,
      channels: "email+phone",
      smsBody: SMS_OUTBOUND_DELIVERED,
      transactionalSms: true,
    });
    return;
  }

  if (context === "cart_return" && to === "dropped_out") {
    const uberHome = await loadCartUsesUberHomeDelivery(admin, cartId);
    const { subject, text, html } = returnDroppedOutEmail(member.firstName);
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.returnMemberDroppedParcel,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:dropped_out`,
      metadata: { ...meta, uber_home_delivery: uberHome },
      subject,
      text,
      html,
      channels: uberHome ? "email" : "email+phone",
      smsBody: uberHome ? undefined : SMS_RETURN_AT_RELAY,
      transactionalSms: !uberHome,
    });
    return;
  }

  if (context === "cart_return" && (to === "returned" || to === "en_verification")) {
    const { subject, text, html } = returnReceivedBySegnaEmail(member.firstName);
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.returnReceivedBySegna,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:${to}`,
      metadata: meta,
      subject,
      text,
      html,
      channels: "email",
    });
  }
}

/** Utilisé par le cron de rappels d’échéance emprunt (e-mail + SMS si activé). */
export async function notifyBorrowDeadlineReminder(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    phase: BorrowReturnReminderPhase;
    idempotencyBucket?: string;
    /** @deprecated conservé pour métadonnées (jours entiers avant l’instant limite). */
    templateDaysLeft?: number;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const label = `Commande ${input.cartId.slice(0, 8)}…`;
  const { subject, text, html, smsBody } = borrowDeadlineReminderEmail(firstName, {
    phase: input.phase,
    cartLabel: label,
  });
  const bucket = input.idempotencyBucket?.trim() ?? input.phase;
  const daysMeta =
    input.templateDaysLeft ??
    (input.phase === "jminus7" ? 7 : input.phase === "jminus3" ? 3 : input.phase === "jminus1" ? 1 : 0);
  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowReturnDeadlineReminder,
    idempotencyKey: `txn:lc:borrow:${input.cartId}:reminder:${bucket}`,
    metadata: { cart_id: input.cartId, days_left: daysMeta, phase: input.phase },
    subject,
    text,
    html,
    channels: "email+phone",
    smsBody,
  });
}
