import { isHttpUrl, resolveItemPhotoData } from "@/lib/cart/fetch-active-cart-lines";
import { buildMemberOrderTimeline } from "@/lib/cart/build-member-order-timeline";
import type { OrderTimelineEntry } from "@/lib/cart/build-member-order-timeline";
import {
  createSignedUrlForStoragePath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";
import { fetchCartCheckoutPaymentDetail } from "@/lib/stripe/fetch-cart-checkout-payment-detail";
import { cartOrderStripeInvoiceJsonToEuroDetail } from "@/lib/stripe/upsert-cart-order-stripe-invoice";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- client query builder
type SupabaseLike = {
  from: (t: string) => any;
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

export type MemberCartOrderShipment = {
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Renseigné au passage pending → ready (back-office). */
  readyAt: string | null;
  trackingNumber: string | null;
};

/** Expédition retour panier (`context = cart_return`) — étiquette membre → Segna. */
export type MemberCartOrderReturnShipment = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  labelUrl: string | null;
};

/** Dès que le colis retour est pris en charge au relais par le membre (`dropped_out` et suivants), le délai de retour est réputé respecté. */
export function isCartReturnCommitmentMet(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s === "dropped_out" ||
    s === "in_transit_in" ||
    s === "in_transit_out" ||
    s === "returned" ||
    s === "en_verification" ||
    s === "return_validated" ||
    s === "closed"
  );
}

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
  /** Bouton « Annuler » : expédition aller `pending` et aucun encaissement Stripe enregistré. */
  canRequest: boolean;
  disabledReason: "canceled" | "archived" | "stripe_paid" | "shipment_started" | null;
};

export type MemberCartOrderDetail = {
  cartId: string;
  orderNumberCompact: string;
  cartStatus: string;
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
    .select("id,status,created_at,updated_at,user_id")
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
      }
    | null;

  if (!cart || !["confirmed", "archived", "canceled"].includes(cart.status)) {
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
      /* `*` évite une erreur PostgREST si `ready_at` n’est pas encore migré (sinon tout le shipment disparaît côté UI). */
      .select("*")
      .eq("cart_id", cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shipments")
      .select("id, status, tracking_number, created_at, updated_at, shipment_labels(label_url)")
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
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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
  await Promise.all(
    [...pathsToSign].map(async (path) => {
      const signed = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
      if (signed) signedPhotoByPath.set(path, signed);
    }),
  );

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
    const ra = shipRow.ready_at;
    const tn = shipRow.tracking_number;
    return {
      status: shipRow.status,
      createdAt: String(shipRow.created_at ?? ""),
      updatedAt: String(shipRow.updated_at ?? ""),
      readyAt: typeof ra === "string" && ra.trim() ? ra.trim() : null,
      trackingNumber: typeof tn === "string" && tn.trim() ? tn.trim() : null,
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
    return {
      id: String(returnShipRow.id ?? ""),
      status: returnShipRow.status,
      createdAt: String(returnShipRow.created_at ?? ""),
      updatedAt: String(returnShipRow.updated_at ?? ""),
      trackingNumber: typeof tn === "string" && tn.trim() ? tn.trim() : null,
      labelUrl,
    };
  })();

  const timeline = buildMemberOrderTimeline(
    cart.created_at,
    historyRows,
    shipment
      ? { created_at: shipment.createdAt, updated_at: shipment.updatedAt, status: shipment.status }
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

  let euroDetail = cartOrderStripeInvoiceJsonToEuroDetail(
    stripeInvoiceRes.error ? null : stripeInvoiceRes.data,
  );

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

  const paidEuros = paymentBreakdown?.euroDetail?.totalPaidEuros ?? 0;
  const stripePaidRecorded = paidEuros > 0.005;

  const debitRow = (cartDebitRes.error ? null : cartDebitRes.data) as {
    amount_points: number;
    credit_bucket: string | null;
    metadata: Record<string, unknown> | null;
  } | null;

  let pointsPaidSplit: MemberCartOrderPointsPaidSplit | null = null;
  if (debitRow) {
    const amt = Math.max(0, Math.floor(Number(debitRow.amount_points ?? 0)));
    const splitRaw = debitRow.metadata?.debit_split;
    if (splitRaw && typeof splitRaw === "object" && !Array.isArray(splitRaw)) {
      const s = splitRaw as Record<string, unknown>;
      const ex = Math.max(0, Math.floor(Number(s.exchange_points ?? 0)));
      const co = Math.max(0, Math.floor(Number(s.consumption_points ?? 0)));
      if (ex + co > 0) {
        pointsPaidSplit = { exchangePoints: ex, consumptionPoints: co, totalPoints: amt };
      }
    }
    if (!pointsPaidSplit) {
      const b = (debitRow.credit_bucket ?? "").trim().toLowerCase();
      if (b === "exchange") {
        pointsPaidSplit = { exchangePoints: amt, consumptionPoints: 0, totalPoints: amt };
      } else if (b === "consumption") {
        pointsPaidSplit = { exchangePoints: 0, consumptionPoints: amt, totalPoints: amt };
      } else if (b === "mixed") {
        pointsPaidSplit = null;
      } else if (amt > 0) {
        pointsPaidSplit = { exchangePoints: amt, consumptionPoints: 0, totalPoints: amt };
      }
    }
  }

  const shipLc = shipment?.status?.toLowerCase() ?? "";
  let cancellationReason: MemberCartOrderCancellation["disabledReason"] = null;
  if (cart.status === "canceled") cancellationReason = "canceled";
  else if (cart.status === "archived") cancellationReason = "archived";
  else if (stripePaidRecorded) cancellationReason = "stripe_paid";
  else if (cart.status === "confirmed" && shipment && shipLc !== "pending") {
    cancellationReason = "shipment_started";
  }

  const orderCancellation: MemberCartOrderCancellation = {
    canRequest: cart.status === "confirmed" && shipLc === "pending" && !stripePaidRecorded,
    disabledReason: cancellationReason,
  };

  return {
    cartId: cart.id,
    orderNumberCompact: formatOrderNumberCompact(cart.id),
    cartStatus: cart.status,
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
