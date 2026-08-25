import type { SupabaseClient } from "@supabase/supabase-js";

import type { BorrowOverdueChargeFailureReason } from "@/lib/cart/format-borrow-overdue-copy";
import { loadCartUsesUberHomeDelivery } from "@/lib/cart/load-cart-uber-home-delivery";
import type { BorrowReturnReminderPhase } from "@/lib/emprunt/borrow-return-reminder-buckets";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  appendSmsAppLink,
  memberAppCommandeUrl,
  memberAppEmpruntUrl,
  memberAppProfilePaymentUrl,
  memberAppRetourUrl,
  memberBorrowOverdueRegulariserUrl,
} from "@/lib/notifications/member-app-links";
import {
  canCheckoutBorrowOverduePenalties,
  fetchBorrowOverdueUnpaidDays,
  sumBorrowOverdueUnpaidCents,
} from "@/lib/stripe/borrow-overdue-checkout";
import {
  borrowDeadlineReminderEmail,
  borrowOverdueDailyEmail,
  orderOutboundReadyEmail,
  orderOutboundRelayPickupAvailableEmail,
  returnConfirmedEmail,
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

/** `dropped_out` (aller) : disponible pour retrait au point relais. */
const SMS_OUTBOUND_RELAY_AVAILABLE =
  "Ton colis est disponible en point relais ! Détails et suivi sur le mail du partenaire d'expédition !";
const SMS_RETURN_AT_RELAY = "Ton retour au relais est enregistré. Merci !";

/** Retour `dropped_in` : pris en charge transporteur — fin de l’échange côté membre. */
function buildReturnDroppedInExchangeCompleteSms(): string {
  return [
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
 * Aller : `ready` (pending → ready) → e-mail + SMS/push ; `dropped_in` → SMS/push ; `dropped_out` → e-mail + SMS/push (dispo au relais), sauf Uber domicile ; `delivered` → push/SMS « Tout est OK ».
 * Retour : `dropped_out` → e-mail + SMS (dépôt relais) ; `dropped_in` → SMS seul (échange terminé) ;
 * `returned` / `en_verification` → e-mail ; `closed` via `close_cart_return_verification_ok` → retour confirmé (+ modale avis).
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
      smsEvenIfPushDelivered: true,
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
      smsEvenIfPushDelivered: true,
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
      smsEvenIfPushDelivered: true,
    });
    return;
  }

  if (context === "cart_outbound" && to === "delivered") {
    const pushBody = "Clique sur Tout est OK pour finaliser ta commande";
    const commandeUrl = memberAppCommandeUrl(cartId);
    await sendMemberSmsOnlyNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.orderOutboundDelivered,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:delivered`,
      metadata: meta,
      pushTitle: "Commande livrée",
      pushBody,
      smsBody: appendSmsAppLink(pushBody, commandeUrl),
      transactionalSms: true,
      smsEvenIfPushDelivered: true,
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
    return;
  }

  // Reprise sans litige (RPC close_cart_return_verification_ok) — pas les clôtures avec litige.
  const sourceLc = String(input.source ?? "").toLowerCase();
  if (
    context === "cart_return" &&
    to === "closed" &&
    sourceLc.includes("close_cart_return_verification_ok")
  ) {
    const retourUrl = `${memberAppRetourUrl(cartId)}?review=1`;
    const { subject, text, html } = returnConfirmedEmail(member.firstName, { retourUrl });
    const pushBody = "Ton retour est nickel. Merci pour ton échange — à bientôt chez Segna !";
    await sendMemberOutreachNotification(admin, {
      userId: member.userId,
      kind: NotificationKind.returnConfirmed,
      idempotencyKey: `txn:lc:ship:${input.shipmentId}:return_confirmed`,
      metadata: {
        ...meta,
        deep_link: "retour",
        open_return_review_sheet: true,
      },
      subject,
      text,
      html,
      channels: "email+phone",
      pushTitle: "Tout est bon !",
      pushBody,
      smsBody: appendSmsAppLink(pushBody, retourUrl),
      transactionalSms: true,
    });
  }
}

/** Utilisé par le cron de rappels d’échéance emprunt (e-mail + push ; SMS seulement le J-J). */
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
  /** J-J : e-mail + push + SMS. Autres J-x : e-mail + push seulement. */
  const keepSms = input.phase === "jj";
  const empruntUrl = memberAppEmpruntUrl(input.cartId);
  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowReturnDeadlineReminder,
    idempotencyKey: `txn:lc:borrow:${input.cartId}:reminder:${bucket}`,
    metadata: { cart_id: input.cartId, days_left: daysMeta, phase: input.phase },
    subject,
    text,
    html,
    channels: keepSms ? "email+phone" : "email",
    pushTitle: subject,
    pushBody: smsBody,
    ...(keepSms
      ? {
          smsBody: appendSmsAppLink(smsBody, empruntUrl),
          transactionalSms: true,
          smsEvenIfPushDelivered: true,
        }
      : {}),
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
    chargeFailureReason?: BorrowOverdueChargeFailureReason;
    calendarDate: string;
    chargedViaStripe?: boolean;
    cronSmsNowMs?: number;
    skipCronSmsDailyCap?: boolean;
    /** Défaut : `txn:lc:borrow_overdue:{cartId}:{calendarDate}` */
    idempotencyKey?: string;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const cartLabel = `Commande ${input.cartId.slice(0, 8).toUpperCase()}`;
  const ratePercent = Math.round(input.rateBps / 100);

  let regulariserUrl: string | null = null;
  let profilePaymentUrl: string | null = null;
  if (input.chargeStatus !== "charged" && !input.chargedViaStripe) {
    try {
      const unpaidDays = await fetchBorrowOverdueUnpaidDays(admin, input.cartId);
      const unpaidTotalCents = sumBorrowOverdueUnpaidCents(unpaidDays);
      if (canCheckoutBorrowOverduePenalties(unpaidTotalCents)) {
        regulariserUrl = memberBorrowOverdueRegulariserUrl(input.cartId);
      } else if (
        input.chargeFailureReason === "no_payment_method" ||
        input.chargeFailureReason === "card_declined"
      ) {
        profilePaymentUrl = memberAppProfilePaymentUrl();
      }
    } catch {
      if (
        input.chargeFailureReason === "no_payment_method" ||
        input.chargeFailureReason === "card_declined"
      ) {
        profilePaymentUrl = memberAppProfilePaymentUrl();
      }
    }
  }

  const { subject, text, html, smsBody } = borrowOverdueDailyEmail(firstName, {
    cartLabel,
    lateDayIndex: input.lateDayIndex,
    penaltyCents: input.penaltyCents,
    penaltyCredits: input.penaltyCredits,
    ratePercent,
    chargeStatus: input.chargeStatus,
    chargeFailureReason: input.chargeFailureReason,
    chargedViaStripe: input.chargedViaStripe,
    regulariserUrl,
    profilePaymentUrl,
  });

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.borrowOverdueDaily,
    idempotencyKey:
      input.idempotencyKey ?? `txn:lc:borrow_overdue:${input.cartId}:${input.calendarDate}`,
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
    /** Retard J+x : e-mail + push, pas de SMS (SMS réservé J-J + MED). */
    channels: "email",
    pushTitle: subject,
    pushBody: smsBody,
    cronSmsNowMs: input.cronSmsNowMs,
    skipCronSmsDailyCap: input.skipCronSmsDailyCap,
  });
}
