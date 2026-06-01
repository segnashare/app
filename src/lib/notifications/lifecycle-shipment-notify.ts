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
  borrowOverdueDailyEmail,
  buildMemberCartOrderPageUrl,
  orderOutboundDeliveredEmail,
  orderOutboundReadyEmail,
  orderOutboundRelayPickupAvailableEmail,
  returnDroppedOutEmail,
  returnReceivedBySegnaEmail,
} from "@/lib/notifications/lifecycle-shipment-email";
import {
  buildOutboundReadySmsBody,
  buildOutboundTransitPartnerSmsBody,
  resolveOutboundTrackingForNotify,
} from "@/lib/notifications/outbound-tracking-for-notify";
import { notifyMemberIntakeDroppedInAfterTransition } from "@/lib/notifications/lifecycle-member-intake-notify";
import { sendMemberOutreachNotification, sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

/** `dropped_out` (aller) : disponible pour retrait au point relais. */
const SMS_OUTBOUND_RELAY_AVAILABLE =
  "Segna : Ton colis est disponible en point relais ! Détails et suivi sur le mail du partenaire d'expédition !";
/** `delivered` (aller, depuis transit) : livraison confirmée — e-mail récap + SMS. */
function buildOutboundDeliveredSms(cartId: string): string {
  const lines = [
    "Ton colis Segna devrait être chez toi.",
    "",
    "Profite bien de ta box !",
    "Signale le moindre problème dans l’app.",
    "",
    "Bon échange !",
  ];
  const orderUrl = buildMemberCartOrderPageUrl(cartId);
  if (orderUrl) {
    lines.push("", orderUrl);
  }
  return lines.join("\n");
}
const SMS_RETURN_AT_RELAY = "Segna : ton retour au relais est enregistré. Merci !";

/** Retour `dropped_in` : pris en charge transporteur — fin de l’échange côté membre. */
function buildReturnDroppedInExchangeCompleteSms(): string {
  return [
    "Segna",
    "",
    "Ton échange est terminé.",
    "",
    "Ton colis retour est bien pris en charge — plus rien à faire de ton côté (délais, suivi du retour, dépôt relais).",
    "",
    "Nous vérifions chez Segna le contenu du colis ; nous te recontacterons uniquement en cas d’écart.",
    "",
    "Merci !",
  ].join("\n");
}

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

/** Statuts « avant livraison » pour lesquels on envoie le récap livré (Uber, relais, legacy). */
function shouldNotifyOutboundDeliveredRecap(fromStatus: string): boolean {
  const f = normalizeOutboundShipmentStatusForUi(fromStatus);
  if (f === "delivered" || f === "closed") return false;
  return true;
}

export const OUTBOUND_DELIVERED_RECAP_IDEMPOTENCY_SUFFIX = "outbound_delivered_recap";
export const OUTBOUND_DELIVERED_SMS_IDEMPOTENCY_SUFFIX = "outbound_delivered_sms";

export type OutboundDeliveredRecapNotifyResult =
  | { ok: true; emailAttempted: boolean; smsAttempted: boolean }
  | { ok: false; reason: string };

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
  const [{ data: ship, error: shipErr }, { data: cartRow, error: cartErr }] = await Promise.all([
    admin.from("shipments").select("delivered_at, updated_at").eq("id", shipmentId).maybeSingle(),
    admin.from("carts").select("borrow_return_due_at").eq("id", cartId).maybeSingle(),
  ]);
  if (cartErr) {
    console.error("[notifications] loadOutboundDeliveredNotificationContext cart", cartErr.message);
  }
  if (shipErr) {
    console.error("[notifications] loadOutboundDeliveredNotificationContext shipment", shipErr.message);
    return null;
  }
  if (!ship) {
    console.warn("[notifications] loadOutboundDeliveredNotificationContext: shipment introuvable", { shipmentId });
    return null;
  }

  const deliveredIso = resolveOutboundBorrowDeliveredAtIso(
    (ship as { delivered_at?: string | null } | null)?.delivered_at,
    (ship as { updated_at?: string | null } | null)?.updated_at,
  );
  let deliveredAtMs = deliveredIso ? Date.parse(deliveredIso) : Number.NaN;
  if (!Number.isFinite(deliveredAtMs)) {
    deliveredAtMs = Date.now();
  }

  const membership = (await resolveMembershipLabelForServiceRole(admin, userId)) as SegnaBorrowMembershipLabel;
  const storedDue = (cartRow as { borrow_return_due_at?: string | null } | null)?.borrow_return_due_at;
  const storedMs = typeof storedDue === "string" && storedDue.trim() ? Date.parse(storedDue) : Number.NaN;
  const deadlineMs = Number.isFinite(storedMs)
    ? storedMs
    : computeBorrowDeadlineMs(deliveredAtMs, membership);
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

/**
 * Récap livraison aller — déclenché uniquement quand le statut passe à `delivered`
 * (webhook Uber sur segna-app, ou rattrapage `POST /api/internal/shipment-lifecycle-notify`).
 * Contrairement au SMS « colis prêt » (back-office → API interne), ce flux ne part pas du BO.
 */
export async function sendOutboundDeliveredRecap(
  admin: SupabaseClient,
  input: {
    shipmentId: string;
    cartId: string;
    userId: string;
    firstName: string | null;
    fromStatus: string;
    meta: Record<string, unknown>;
  },
): Promise<OutboundDeliveredRecapNotifyResult> {
  if (!shouldNotifyOutboundDeliveredRecap(input.fromStatus)) {
    return { ok: false, reason: `from_status_skip:${input.fromStatus}` };
  }

  const deliveredCtx = await loadOutboundDeliveredNotificationContext(
    admin,
    input.cartId,
    input.userId,
    input.shipmentId,
  );
  if (!deliveredCtx) {
    console.warn("[notifications] outbound delivered recap: contexte incomplet", {
      shipmentId: input.shipmentId,
      cartId: input.cartId,
      from: input.fromStatus,
    });
    return { ok: false, reason: "load_context_failed" };
  }

  const supportEmail = getSegnaSupportContact().email ?? "contact@segnashare.com";
  const { subject, text, html } = orderOutboundDeliveredEmail({
    firstName: input.firstName,
    cartId: input.cartId,
    orderRef: deliveredCtx.orderRef,
    itemLabels: deliveredCtx.itemLabels,
    borrowPeriodLabel: deliveredCtx.borrowPeriodLabel,
    returnDeadlineLabel: deliveredCtx.returnDeadlineLabel,
    supportEmail,
  });

  const recapMeta = {
    ...input.meta,
    membership: deliveredCtx.membershipLabel,
    return_deadline: deliveredCtx.returnDeadlineLabel,
  };

  // E-mail et SMS séparés (comme « colis prêt » = SMS seul) : un échec Resend ne bloque plus le SMS.
  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.orderOutboundDelivered,
    idempotencyKey: `txn:lc:ship:${input.shipmentId}:${OUTBOUND_DELIVERED_RECAP_IDEMPOTENCY_SUFFIX}`,
    metadata: recapMeta,
    subject,
    text,
    html,
    channels: "email",
  });

  await sendMemberSmsOnlyNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.orderOutboundDelivered,
    idempotencyKey: `txn:lc:ship:${input.shipmentId}:${OUTBOUND_DELIVERED_SMS_IDEMPOTENCY_SUFFIX}`,
    metadata: recapMeta,
    smsBody: buildOutboundDeliveredSms(input.cartId),
    transactionalSms: true,
  });

  return { ok: true, emailAttempted: true, smsAttempted: true };
}

async function loadOutboundReadyNotifyTracking(
  admin: SupabaseClient,
  shipmentId: string,
  cartId: string,
) {
  const [shipRes, cartRes, uberHome] = await Promise.all([
    admin
      .from("shipments")
      .select("tracking_number, member_tracking_url")
      .eq("id", shipmentId)
      .maybeSingle(),
    admin.from("carts").select("sendcloud_outbound_order_number").eq("id", cartId).maybeSingle(),
    loadCartUsesUberHomeDelivery(admin, cartId),
  ]);

  const ship = shipRes.data as { tracking_number?: string | null; member_tracking_url?: string | null } | null;
  const cart = cartRes.data as { sendcloud_outbound_order_number?: string | null } | null;

  return resolveOutboundTrackingForNotify({
    cartId,
    trackingNumber: ship?.tracking_number ?? null,
    memberTrackingUrl: ship?.member_tracking_url ?? null,
    isUberHome: uberHome,
    sendcloudOrderNumber: cart?.sendcloud_outbound_order_number ?? null,
  });
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
 * Aller : `ready` (pending → ready) → e-mail + SMS (réf. commande, n° suivi, lien) ; `dropped_in` → SMS seul ; `dropped_out` → e-mail + SMS (dispo au relais), sauf Uber domicile ; `delivered` → e-mail récap + SMS.
 * Retour : `dropped_out` → e-mail + SMS (dépôt relais) ; `dropped_in` → SMS seul (échange terminé) ; `returned` / `en_verification` → e-mail.
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

  if (context === "member_intake") {
    await notifyMemberIntakeDroppedInAfterTransition(admin, input);
    return;
  }

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
    const tracking = await loadOutboundReadyNotifyTracking(admin, input.shipmentId, cartId);
    const { subject, text, html } = orderOutboundReadyEmail({
      firstName: member.firstName,
      orderRef: tracking.orderRef,
      trackingNumber: tracking.trackingNumber,
      trackingUrl: tracking.trackingUrl,
    });
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundReadyToShip,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:ready`,
      metadata: {
        ...meta,
        pending_to_ready: true,
        order_ref: tracking.orderRef,
        tracking_number: tracking.trackingNumber,
        tracking_url: tracking.trackingUrl,
      },
      subject,
      text,
      html,
      channels: "email+phone",
      smsBody: buildOutboundReadySmsBody(tracking),
      transactionalSms: true,
    });
    return;
  }

  if (context === "cart_outbound" && to === "dropped_in") {
    const uberHome = await loadCartUsesUberHomeDelivery(admin, cartId);
    if (uberHome) return;

    const [tracking, itemLabels] = await Promise.all([
      loadOutboundReadyNotifyTracking(admin, input.shipmentId, cartId),
      loadCartOrderItemLabels(admin, cartId),
    ]);

    await sendMemberSmsOnlyNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundTransitPartner,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:dropped_in_transit_sms`,
      metadata: {
        ...meta,
        order_ref: tracking.orderRef,
        tracking_number: tracking.trackingNumber,
        tracking_url: tracking.trackingUrl,
        item_labels: itemLabels,
      },
      smsBody: buildOutboundTransitPartnerSmsBody({ itemLabels, tracking }),
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

  if (context === "cart_outbound" && to === "delivered") {
    await sendOutboundDeliveredRecap(admin, {
      shipmentId: input.shipmentId,
      cartId,
      userId: member.userId,
      firstName: member.firstName,
      fromStatus: from,
      meta,
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

  if (context === "cart_return" && to === "dropped_in") {
    await sendMemberSmsOnlyNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.returnExchangeComplete,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:return_dropped_in_exchange_complete`,
      metadata: meta,
      smsBody: buildReturnDroppedInExchangeCompleteSms(),
      transactionalSms: true,
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
    cronSmsNowMs?: number;
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
    applyCronSmsDailyCap: true,
    cronSmsNowMs: input.cronSmsNowMs,
  });
}

/** Pénalité journalière de retard retour (`cart_borrow_overdue_days`). */
export async function notifyBorrowOverdueDaily(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    lateDayIndex: number;
    penaltyCents: number;
    penaltyCredits: number;
    rateBps: number;
    chargeStatus: string;
    calendarDate: string;
    chargedViaStripe?: boolean;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const cartLabel = `Commande ${input.cartId.slice(0, 8).toUpperCase()}`;
  const ratePercent = Math.round(input.rateBps / 100);

  const { subject, text, html, smsBody } = borrowOverdueDailyEmail(firstName, {
    cartLabel,
    lateDayIndex: input.lateDayIndex,
    penaltyCents: input.penaltyCents,
    penaltyCredits: input.penaltyCredits,
    ratePercent,
    chargeStatus: input.chargeStatus,
    chargedViaStripe: input.chargedViaStripe,
  });

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowOverdueDaily,
    idempotencyKey: `txn:lc:borrow_overdue:${input.cartId}:${input.calendarDate}`,
    metadata: {
      cart_id: input.cartId,
      late_day_index: input.lateDayIndex,
      penalty_cents: input.penaltyCents,
      charge_status: input.chargeStatus,
      calendar_date: input.calendarDate,
    },
    subject,
    text,
    html,
    channels: "email+phone",
    smsBody,
    applyCronSmsDailyCap: true,
    cronSmsNowMs: input.cronSmsNowMs,
  });
}
