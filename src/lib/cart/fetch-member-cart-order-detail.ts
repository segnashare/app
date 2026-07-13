import { isHttpUrl, resolveItemPhotoData } from "@/lib/cart/fetch-active-cart-lines";
import { buildMemberOrderTimeline } from "@/lib/cart/build-member-order-timeline";
import type { OrderTimelineEntry } from "@/lib/cart/build-member-order-timeline";
import {
  createSignedUrlsForStoragePaths,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";
import { fetchCartCheckoutPaymentDetail } from "@/lib/stripe/fetch-cart-checkout-payment-detail";
import { cartOrderStripeInvoiceJsonToEuroDetail, guestPurchaseStripeInvoiceHostedUrlFromJson, guestPurchaseStripeInvoiceIdFromJson } from "@/lib/stripe/upsert-cart-order-stripe-invoice";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";
import { hasPreprintedCartReturnLabel } from "@/lib/cart/cart-return-provision-meta";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";

type QueryResult = { data: unknown; error?: { message?: string } | null };
type QueryBuilderLike = PromiseLike<QueryResult> & {
  eq: (column: string, value: unknown) => QueryBuilderLike;
  is: (column: string, value: unknown) => QueryBuilderLike;
  filter: (column: string, operator: string, value: unknown) => QueryBuilderLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilderLike;
  limit: (count: number) => QueryBuilderLike;
  maybeSingle: () => PromiseLike<QueryResult>;
};
type TableBuilderLike = { select: (columns: string) => QueryBuilderLike };
type SupabaseLike = {
  from: (table: string) => TableBuilderLike;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

type OrderDetailSupabase = SupabaseLike & StorageSignClient;

export type MemberCartOrderLine = {
  id: string;
  itemId: string;
  itemName: string;
  brand: string | null;
  description: string | null;
  pricePoints: number;
  photoUrl: string | null;
  photoPosition: CartLineRowData["photoPosition"];
};

/** Snapshot du devis Uber au moment de la création de la course (métadonnées `shipment_destinations` domicile). */
export type MemberCartOrderUberBooking = {
  feeCents: number | null;
  dropoffEta: string | null;
  pickupEta: string | null;
  durationMin: number | null;
  pickupDurationMin: number | null;
  quoteExpiresAt: string | null;
  recordedAt: string | null;
};

export type MemberCartOrderShipment = {
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Réception aller (`shipments.delivered_at`) — base des délais d’emprunt ; null avant migration / si jamais livré. */
  deliveredAt: string | null;
  /** Renseigné au passage pending → ready (back-office). */
  readyAt: string | null;
  trackingNumber: string | null;
  /** `shipment_providers.code` (ex. uber_direct, mondial_relay). */
  outboundProviderCode: string | null;
  /** Lien suivi membre (ex. Uber `tracking_url`). */
  memberTrackingUrl: string | null;
  uberBooking: MemberCartOrderUberBooking | null;
};

/** Expédition retour panier (`context = cart_return`) — étiquette membre → Segna. */
export type MemberCartOrderReturnShipment = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  memberTrackingUrl: string | null;
  labelUrl: string | null;
  /** Bordereau retour déjà imprimé (pochette aller), pas portail membre. */
  preprintedReturnLabel: boolean;
};

export { isCartReturnCommitmentMet } from "@/lib/cart/cart-return-status";

/** Crédits Segna (wallet) — distinct des montants € carte. */
export type MemberCartOrderCreditSplit = {
  pointsFromLendingBalance: number;
  /** Unités créditées via Stripe puis consommées sur le débit panier. */
  pointsFromExchangeComplement: number;
};

/** Répartition affichée sur la page commande : crédits (wallet) + facture € (snapshot Stripe). */
export type MemberCartOrderPaymentBreakdown = {
  creditSplit: MemberCartOrderCreditSplit | null;
  /**
   * Snapshot en base (`cart_order_stripe_invoices`) ou repli API Stripe (commandes anciennes).
   * null si aucune source disponible.
   */
  euroDetail: {
    complementCreditsEuros: number;
    serviceFeeEuros: number;
    shippingFeeEuros: number;
    totalPaidEuros: number;
    feesVatEuros?: number;
    feesTtcEuros?: number;
  } | null;
};

/** Répartition du débit panier (wallet) — pour affichage / annulation. */
export type MemberCartOrderPointsPaidSplit = {
  exchangePoints: number;
  consumptionPoints: number;
  totalPoints: number;
};

export type MemberCartOrderCancellation = {
  /** Bouton « Annuler » : commande confirmée et expédition aller `pending` ou `ready` (avant prise en charge transporteur). */
  canRequest: boolean;
  disabledReason: "canceled" | "archived" | "stripe_paid" | "shipment_started" | null;
};

export type MemberCartOrderDetail = {
  cartId: string;
  orderNumberCompact: string;
  cartStatus: string;
  /** Validation « bonne réception » par le membre (`carts.member_receipt_confirmed_at`). */
  memberReceiptConfirmedAt: string | null;
  /** Échéance de retour figée (`carts.borrow_return_due_at`), null avant livraison / legacy. */
  borrowReturnDueAt: string | null;
  /** Durée d'emprunt choisie au checkout (`carts.checkout_borrow_duration_days`). */
  checkoutBorrowDurationDays: number | null;
  /** Commande passée en mode achat Guest. */
  isPurchaseOrder: boolean;
  /** URL Stripe pour consulter / télécharger la facture achat. */
  stripeInvoiceDownloadUrl: string | null;
  createdAtIso: string;
  lines: MemberCartOrderLine[];
  totalPoints: number;
  walletCreditKind: WalletCreditKind;
  shipment: MemberCartOrderShipment | null;
  /** null si aucune ligne retour encore créée. */
  returnShipment: MemberCartOrderReturnShipment | null;
  timeline: OrderTimelineEntry[];
  /** null si ni wallet context ni facture € en base / Stripe. */
  paymentBreakdown: MemberCartOrderPaymentBreakdown | null;
  /** null si débit panier introuvable (ancienne commande / données manquantes). */
  pointsPaidSplit: MemberCartOrderPointsPaidSplit | null;
  orderCancellation: MemberCartOrderCancellation;
};

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function parseUberBookingFromDestinationMetadata(metadata: unknown): MemberCartOrderUberBooking | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const feeRaw = m.uber_booking_fee_cents;
  let feeCents: number | null = null;
  if (typeof feeRaw === "number" && Number.isFinite(feeRaw)) {
    feeCents = Math.round(feeRaw);
  } else if (typeof feeRaw === "string" && feeRaw.trim() !== "") {
    const n = Number(feeRaw);
    if (Number.isFinite(n)) feeCents = Math.round(n);
  }
  const dropoffEta = typeof m.uber_booking_dropoff_eta === "string" ? m.uber_booking_dropoff_eta : null;
  const pickupEta = typeof m.uber_booking_pickup_eta === "string" ? m.uber_booking_pickup_eta : null;
  const recordedAt = typeof m.uber_booking_recorded_at === "string" ? m.uber_booking_recorded_at : null;
  const quoteExpiresAt = typeof m.uber_booking_quote_expires === "string" ? m.uber_booking_quote_expires : null;
  const durRaw = m.uber_booking_duration_min;
  const pudRaw = m.uber_booking_pickup_duration_min;
  const durationMin =
    typeof durRaw === "number"
      ? durRaw
      : typeof durRaw === "string" && durRaw.trim() !== ""
        ? Number(durRaw)
        : null;
  const pickupDurationMin =
    typeof pudRaw === "number"
      ? pudRaw
      : typeof pudRaw === "string" && String(pudRaw).trim() !== ""
        ? Number(pudRaw)
        : null;

  const hasAny =
    (feeCents != null && feeCents >= 0) ||
    (dropoffEta != null && dropoffEta.trim() !== "") ||
    (recordedAt != null && recordedAt.trim() !== "");
  if (!hasAny) return null;

  return {
    feeCents: feeCents != null && feeCents >= 0 ? feeCents : null,
    dropoffEta: dropoffEta?.trim() || null,
    pickupEta: pickupEta?.trim() || null,
    durationMin: durationMin != null && Number.isFinite(durationMin) ? durationMin : null,
    pickupDurationMin: pickupDurationMin != null && Number.isFinite(pickupDurationMin) ? pickupDurationMin : null,
    quoteExpiresAt: quoteExpiresAt?.trim() || null,
    recordedAt: recordedAt?.trim() || null,
  };
}

/**
 * Détail commande membre (panier confirmé / archivé) pour la page `commande/[id]`.
 */
export async function fetchMemberCartOrderDetail(
  supabase: OrderDetailSupabase,
  userId: string,
  cartId: string,
  walletCreditKind: WalletCreditKind,
): Promise<MemberCartOrderDetail | null> {
  const cartRes = await supabase
    .from("carts")
    .select("id,status,created_at,updated_at,user_id,borrow_return_due_at,member_receipt_confirmed_at,checkout_borrow_duration_days,checkout_purchase_mode")
    .eq("id", cartId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const cart = cartRes.data as
    | {
        id: string;
        status: string;
        created_at: string;
        updated_at: string;
        user_id: string;
        borrow_return_due_at?: string | null;
        member_receipt_confirmed_at?: string | null;
        checkout_borrow_duration_days?: number | null;
        checkout_purchase_mode?: boolean | null;
      }
    | null;

  if (!cart || !["confirmed", "archived", "canceled", "disputed"].includes(cart.status)) {
    return null;
  }

  const [linesRes, historyRes, shipmentRes, returnShipRes, checkoutCtxRes, stripeInvoiceRes, cartDebitRes] =
    await Promise.all([
    supabase
      .from("cart_items")
      .select(
        "id, item_id, items(id, title, description, price_points, photos, item_custom_brand_label, item_brands(label))",
      )
      .eq("cart_id", cartId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("cart_status_history")
      .select("created_at, to_status, reason")
      .eq("cart_id", cartId)
      .order("created_at", { ascending: true }),
    supabase
      .from("shipments")
      .select("*, shipment_providers ( code ), shipment_destinations ( destination_type, metadata )")
      .eq("cart_id", cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shipments")
      .select(
        "id, status, tracking_number, member_tracking_url, created_at, updated_at, shipment_labels(label_url), shipment_destinations(metadata)",
      )
      .eq("cart_id", cartId)
      .eq("context", "cart_return")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("get_member_cart_order_checkout_context", { p_cart_id: cartId }),
    supabase.rpc("get_member_cart_order_stripe_invoice", { p_cart_id: cartId }),
    supabase
      .from("wallet_transactions")
      .select("amount_points, credit_bucket, metadata")
      .eq("user_id", userId)
      .eq("kind", "debit")
      .eq("direction", "debit")
      .filter("metadata->>source", "eq", "cart_order_stripe")
      .filter("metadata->>cart_id", "eq", cartId)
      .order("created_at", { ascending: true }),
  ]);

  type ItemJoin = {
    id?: string;
    title?: string | null;
    description?: string | null;
    price_points?: number | null;
    photos?: unknown;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | null;
  } | null;

  const rawLines = (linesRes.error ? [] : (linesRes.data ?? [])) as {
    id: string;
    item_id: string;
    items: ItemJoin;
  }[];

  const signedPhotoByPath = new Map<string, string>();
  const pathsToSign = new Set<string>();
  for (const row of rawLines) {
    const item = row.items;
    const photoData = resolveItemPhotoData(item?.photos ?? null);
    if (photoData.path && !isHttpUrl(photoData.path)) pathsToSign.add(photoData.path);
  }
  const signedUrls = await createSignedUrlsForStoragePaths(supabase, [...pathsToSign], 60 * 60 * 24);
  signedUrls.forEach((signed, path) => signedPhotoByPath.set(path, signed));

  const lines: MemberCartOrderLine[] = rawLines.map((row) => {
    const item = row.items;
    const photoData = resolveItemPhotoData(item?.photos ?? null);
    const rawPath = photoData.path;
    const photoUrl =
      rawPath == null ? null : isHttpUrl(rawPath) ? rawPath : (signedPhotoByPath.get(rawPath) ?? null);

    return {
      id: row.id,
      itemId: row.item_id,
      itemName: item?.title?.trim() || "Pièce sans titre",
      brand:
        (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
        item?.item_brands?.label?.trim() ||
        null,
      description: item?.description?.trim() || null,
      pricePoints: Number(item?.price_points ?? 0),
      photoUrl,
      photoPosition: photoData.position,
    };
  });

  const totalPoints = lines.reduce((s, l) => s + l.pricePoints, 0);

  const historyRows =
    historyRes.error == null
      ? ((historyRes.data ?? []) as { created_at: string; to_status: string; reason: string | null }[])
      : [];

  const shipRow = shipmentRes.data as Record<string, unknown> | null;

  const shipment: MemberCartOrderShipment | null = (() => {
    if (!shipRow || typeof shipRow.status !== "string") return null;
    const da = shipRow.delivered_at;
    const ra = shipRow.ready_at;
    const tn = shipRow.tracking_number;
    const mtu = shipRow.member_tracking_url;
    const provEmb = shipRow.shipment_providers;
    const provObj = Array.isArray(provEmb) ? provEmb[0] : provEmb;
    const provCode =
      provObj && typeof provObj === "object" && typeof (provObj as { code?: unknown }).code === "string"
        ? (provObj as { code: string }).code.trim().toLowerCase()
        : null;
    const destEmb = shipRow.shipment_destinations;
    const destList = Array.isArray(destEmb) ? destEmb : destEmb ? [destEmb] : [];
    const homeRow = destList.find(
      (d) =>
        d &&
        typeof d === "object" &&
        String((d as { destination_type?: string }).destination_type ?? "")
          .trim()
          .toLowerCase() === "home",
    );
    const uberBooking = homeRow
      ? parseUberBookingFromDestinationMetadata((homeRow as { metadata?: unknown }).metadata)
      : null;
    return {
      status: shipRow.status,
      createdAt: String(shipRow.created_at ?? ""),
      updatedAt: String(shipRow.updated_at ?? ""),
      deliveredAt: typeof da === "string" && da.trim() ? da.trim() : null,
      readyAt: typeof ra === "string" && ra.trim() ? ra.trim() : null,
      trackingNumber: typeof tn === "string" && tn.trim() ? tn.trim() : null,
      outboundProviderCode: provCode,
      memberTrackingUrl: typeof mtu === "string" && mtu.trim() ? mtu.trim() : null,
      uberBooking,
    };
  })();

  const returnShipRow = returnShipRes.data as Record<string, unknown> | null;
  const returnShipment: MemberCartOrderReturnShipment | null = (() => {
    if (!returnShipRow || typeof returnShipRow.status !== "string") return null;
    const labelsRaw = returnShipRow.shipment_labels;
    const labelsArr = Array.isArray(labelsRaw) ? labelsRaw : labelsRaw ? [labelsRaw] : [];
    let labelUrl: string | null = null;
    for (const lab of labelsArr) {
      if (!lab || typeof lab !== "object") continue;
      const u = (lab as { label_url?: string }).label_url;
      if (typeof u === "string" && u.trim()) {
        labelUrl = u.trim();
        break;
      }
    }
    const tn = returnShipRow.tracking_number;
    const mtu = returnShipRow.member_tracking_url;
    const rawStatus = returnShipRow.status;
    const normalizedStatus =
      typeof rawStatus === "string"
        ? (normalizeCartReturnShipmentStatus(rawStatus) ?? rawStatus)
        : "pending";
    const destEmb = returnShipRow.shipment_destinations;
    const destRow = Array.isArray(destEmb) ? destEmb[0] : destEmb;
    const returnDestMeta =
      destRow &&
      typeof destRow === "object" &&
      "metadata" in destRow &&
      destRow.metadata &&
      typeof destRow.metadata === "object"
        ? (destRow.metadata as Record<string, unknown>)
        : {};
    const outboundDestEmb = shipRow?.shipment_destinations;
    const outboundDestList = Array.isArray(outboundDestEmb)
      ? outboundDestEmb
      : outboundDestEmb
        ? [outboundDestEmb]
        : [];
    const outboundDestRow = outboundDestList.find(
      (d) => d && typeof d === "object",
    ) as { metadata?: unknown } | undefined;
    const outboundDestMeta =
      outboundDestRow?.metadata && typeof outboundDestRow.metadata === "object"
        ? (outboundDestRow.metadata as Record<string, unknown>)
        : {};
    return {
      id: String(returnShipRow.id ?? ""),
      status: normalizedStatus,
      createdAt: String(returnShipRow.created_at ?? ""),
      updatedAt: String(returnShipRow.updated_at ?? ""),
      trackingNumber: typeof tn === "string" && tn.trim() ? tn.trim() : null,
      memberTrackingUrl: typeof mtu === "string" && mtu.trim() ? mtu.trim() : null,
      labelUrl,
      preprintedReturnLabel: hasPreprintedCartReturnLabel({
        returnShipmentId: String(returnShipRow.id ?? ""),
        destMeta: returnDestMeta,
        outboundDestMeta,
        trackingNumber: typeof tn === "string" && tn.trim() ? tn.trim() : null,
        trackingUrl: typeof mtu === "string" && mtu.trim() ? mtu.trim() : null,
        labelUrl,
      }),
    };
  })();

  const timeline = buildMemberOrderTimeline(
    cart.created_at,
    historyRows,
    shipment
      ? {
          created_at: shipment.createdAt,
          updated_at: shipment.updatedAt,
          status: shipment.status,
          delivered_at: shipment.deliveredAt,
        }
      : null,
  );

  const ctxPayload = checkoutCtxRes.error ? null : checkoutCtxRes.data;
  const ctx = ctxPayload as
    | {
        ok?: boolean;
        points_from_lending_balance?: number;
        wallet_topup_points?: number;
        checkout_session_id?: string | null;
      }
    | null;

  const creditSplit: MemberCartOrderCreditSplit | null =
    ctx && ctx.ok === true
      ? {
          pointsFromLendingBalance: Math.max(0, Math.floor(Number(ctx.points_from_lending_balance ?? 0))),
          pointsFromExchangeComplement: Math.max(0, Math.floor(Number(ctx.wallet_topup_points ?? 0))),
        }
      : null;

  const stripeInvoicePayload = stripeInvoiceRes.error ? null : stripeInvoiceRes.data;
  let euroDetail = cartOrderStripeInvoiceJsonToEuroDetail(stripeInvoicePayload);
  const stripeInvoiceDownloadUrl = guestPurchaseStripeInvoiceHostedUrlFromJson(stripeInvoicePayload);
  const guestPurchaseStripeInvoiceId = guestPurchaseStripeInvoiceIdFromJson(stripeInvoicePayload);

  if (!euroDetail) {
    const sessionId =
      ctx && ctx.ok === true && typeof ctx.checkout_session_id === "string"
        ? ctx.checkout_session_id.trim()
        : "";
    euroDetail = sessionId ? await fetchCartCheckoutPaymentDetail(sessionId) : null;
  }

  const paymentBreakdown: MemberCartOrderPaymentBreakdown | null =
    creditSplit != null || euroDetail != null
      ? { creditSplit, euroDetail }
      : null;

  const debitRows = (cartDebitRes.error ? [] : (cartDebitRes.data ?? [])) as {
    amount_points: number;
    credit_bucket: string | null;
    metadata: Record<string, unknown> | null;
  }[];

  let pointsPaidSplit: MemberCartOrderPointsPaidSplit | null = null;
  if (debitRows.length > 0) {
    let exchangePoints = 0;
    let consumptionPoints = 0;
    for (const debitRow of debitRows) {
      const amt = Math.max(0, Math.floor(Number(debitRow.amount_points ?? 0)));
      const splitRaw = debitRow.metadata?.debit_split;
      if (splitRaw && typeof splitRaw === "object" && !Array.isArray(splitRaw)) {
        const s = splitRaw as Record<string, unknown>;
        exchangePoints += Math.max(0, Math.floor(Number(s.exchange_points ?? 0)));
        consumptionPoints += Math.max(0, Math.floor(Number(s.consumption_points ?? 0)));
      } else {
        const b = (debitRow.credit_bucket ?? "").trim().toLowerCase();
        if (b === "consumption") consumptionPoints += amt;
        else exchangePoints += amt;
      }
    }
    const totalDebitPoints = exchangePoints + consumptionPoints;
    if (totalDebitPoints > 0) {
      pointsPaidSplit = {
        exchangePoints,
        consumptionPoints,
        totalPoints: totalDebitPoints,
      };
    }
  }

  const shipLc = shipment?.status?.toLowerCase() ?? "";
  const outboundCancelable = shipLc === "pending" || shipLc === "ready";
  let cancellationReason: MemberCartOrderCancellation["disabledReason"] = null;
  if (cart.status === "canceled") cancellationReason = "canceled";
  else if (cart.status === "archived") cancellationReason = "archived";
  else if (cart.status === "confirmed" && shipment && !outboundCancelable) {
    cancellationReason = "shipment_started";
  }

  const orderCancellation: MemberCartOrderCancellation = {
    canRequest: cart.status === "confirmed" && shipment != null && outboundCancelable,
    disabledReason: cancellationReason,
  };

  const purchaseFromCart = cart.checkout_purchase_mode === true;
  const purchaseFromWallet = debitRows.some((debitRow) => {
    const raw = debitRow.metadata?.purchase_mode;
    return raw === true || raw === "true";
  });
  const isPurchaseOrder =
    purchaseFromCart || purchaseFromWallet || guestPurchaseStripeInvoiceId != null;

  return {
    cartId: cart.id,
    orderNumberCompact: formatOrderNumberCompact(cart.id),
    cartStatus: cart.status,
    memberReceiptConfirmedAt:
      typeof cart.member_receipt_confirmed_at === "string" && cart.member_receipt_confirmed_at.trim()
        ? cart.member_receipt_confirmed_at
        : null,
    borrowReturnDueAt:
      typeof cart.borrow_return_due_at === "string" && cart.borrow_return_due_at.trim()
        ? cart.borrow_return_due_at
        : null,
    checkoutBorrowDurationDays:
      cart.checkout_borrow_duration_days != null &&
      Number.isFinite(Number(cart.checkout_borrow_duration_days)) &&
      Number(cart.checkout_borrow_duration_days) >= 1
        ? Math.trunc(Number(cart.checkout_borrow_duration_days))
        : null,
    isPurchaseOrder,
    stripeInvoiceDownloadUrl,
    createdAtIso: cart.created_at,
    lines,
    totalPoints,
    walletCreditKind,
    shipment,
    returnShipment,
    timeline,
    paymentBreakdown,
    pointsPaidSplit,
    orderCancellation,
  };
}
