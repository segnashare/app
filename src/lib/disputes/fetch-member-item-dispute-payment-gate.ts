import type { SupabaseClient } from "@supabase/supabase-js";

import { parseCartDisputeOpsSoftGate } from "@/lib/disputes/cart-dispute-ops-soft-gate";
import {
  formatItemDisputePointsEuros,
  isItemDisputeDefectTier,
  itemDisputeDefectTierLabel,
  type ItemDisputeDefectTier,
} from "@/lib/disputes/item-dispute-defect-scale";
import { syncUnpaidItemDisputeInvoicesForCartDisputes } from "@/lib/stripe/sync-item-dispute-invoice-from-stripe";

export type MemberItemDisputePaymentGateLine = {
  itemDisputeId: string;
  itemTitle: string;
  billedPoints: number;
  billingPercent: number;
  amountLabel: string;
};

export type MemberItemDisputePaymentGate = {
  /** payment = facture impayée ; ops_soft = suspension ops manuelle (modale). */
  kind: "payment" | "ops_soft";
  itemDisputeId: string;
  cartId: string | null;
  cartDisputeId: string | null;
  tier: ItemDisputeDefectTier | null;
  tierLabel: string;
  title: string;
  body: string;
  itemTitle: string;
  billedPoints: number;
  billingPercent: number;
  amountLabel: string;
  amountCents: number;
  chargeStatus: "invoiced" | "failed" | "recorded" | "ops_soft";
  stripeInvoiceId: string | null;
  stripeHostedInvoiceUrl: string | null;
  /** Ops a levé le blocage dur : modale dismissible (réapparaît à chaque ouverture). */
  dismissible: boolean;
  commandeHref: string | null;
  empruntHref: string | null;
  /** Détail multi-pièces (même facture). */
  lineItems?: MemberItemDisputePaymentGateLine[];
};

type ResolutionShape = {
  chargeStatus?: string;
  billedPoints?: number;
  billingPercent?: number;
  defectTier?: string;
  stripeInvoiceId?: string | null;
  stripeHostedInvoiceUrl?: string | null;
  paymentGateDismissible?: boolean;
  memberAlert?: {
    title?: string;
    body?: string;
    itemTitle?: string;
    billedPoints?: number;
    billingPercent?: number;
    tier?: string;
    lineItems?: Array<{
      itemDisputeId?: string;
      itemTitle?: string;
      billedPoints?: number;
      billingPercent?: number;
    }>;
    siblingItemDisputeIds?: string[];
  } | null;
  member_alert?: {
    title?: string;
    body?: string;
    itemTitle?: string;
    billedPoints?: number;
    billingPercent?: number;
    tier?: string;
    lineItems?: Array<{
      itemDisputeId?: string;
      itemTitle?: string;
      billedPoints?: number;
      billingPercent?: number;
    }>;
    siblingItemDisputeIds?: string[];
  } | null;
};

function isUnpaidChargeStatus(
  status: string | null | undefined,
): status is "invoiced" | "failed" | "recorded" {
  const st = String(status ?? "").toLowerCase();
  return st === "invoiced" || st === "failed" || st === "recorded";
}

function isPathUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Chemins accessibles malgré la modale (voir commande / emprunt) —
 * aligné sur le gate retard. La bannière paiement reste visible.
 */
export function isItemDisputePaymentGateAllowedPath(
  pathname: string | null | undefined,
  gate: MemberItemDisputePaymentGate,
): boolean {
  const cartId = gate.cartId?.trim();
  if (!cartId || !pathname) return false;
  if (isPathUnder(pathname, `/commande/${cartId}`)) return true;
  if (isPathUnder(pathname, `/exchange/emprunt/${cartId}`)) return true;
  if (isPathUnder(pathname, `/exchange/retour/${cartId}`)) return true;
  return false;
}

/**
 * Litige pièce facturé non payé → blocage app (modale + lien facture Stripe).
 * Statut `in_review` (ou clos si charge encore unpaid) + chargeStatus invoiced/failed/recorded.
 */
export async function fetchMemberItemDisputePaymentGate(
  admin: SupabaseClient,
  userId: string,
): Promise<MemberItemDisputePaymentGate | null> {
  const uid = userId.trim();
  if (!uid) return null;

  const { data: ownedCarts } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", uid)
    .is("deleted_at", null)
    .limit(120);

  const ownedCartIds = (ownedCarts ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter(Boolean);

  const cartIdByDispute = new Map<string, string>();
  const cdIds: string[] = [];

  if (ownedCartIds.length > 0) {
    const { data: byCart } = await admin
      .from("cart_disputes")
      .select("id, cart_id, ops_soft_gate, status")
      .in("cart_id", ownedCartIds)
      .is("deleted_at", null)
      .limit(80);
    for (const r of byCart ?? []) {
      if (typeof r.id !== "string" || typeof r.cart_id !== "string") continue;
      if (!cartIdByDispute.has(r.id)) {
        cartIdByDispute.set(r.id, r.cart_id);
        cdIds.push(r.id);
      }
    }
  }

  // Filet : litiges ouverts par le membre même si le panier a changé de propriétaire (edge).
  const { data: byOpener } = await admin
    .from("cart_disputes")
    .select("id, cart_id, ops_soft_gate, status")
    .eq("opened_by_user_id", uid)
    .is("deleted_at", null)
    .limit(80);
  for (const r of byOpener ?? []) {
    if (typeof r.id !== "string" || typeof r.cart_id !== "string") continue;
    if (!cartIdByDispute.has(r.id)) {
      cartIdByDispute.set(r.id, r.cart_id);
      cdIds.push(r.id);
    }
  }

  if (cdIds.length === 0) return null;

  // Filet webhook local / Stripe CLI : si la facture est déjà payée côté Stripe, sync DB.
  try {
    await syncUnpaidItemDisputeInvoicesForCartDisputes(admin, cdIds);
  } catch (e) {
    console.warn(
      "[item-dispute-payment-gate] sync stripe",
      e instanceof Error ? e.message : String(e),
    );
  }

  const { data: rows } = await admin
    .from("item_disputes")
    .select("id, cart_dispute_id, resolution, status, updated_at")
    .in("cart_dispute_id", cdIds)
    .is("deleted_at", null)
    .in("status", ["in_review", "resolved", "closed"])
    .order("updated_at", { ascending: false })
    .limit(40);

  const seenInvoiceKeys = new Set<string>();

  for (const row of rows ?? []) {
    const resolution =
      row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
        ? (row.resolution as ResolutionShape)
        : null;
    if (!resolution) continue;
    if (!isUnpaidChargeStatus(resolution.chargeStatus)) continue;

    const alert = resolution.memberAlert ?? resolution.member_alert ?? null;
    const tierRaw = String(alert?.tier ?? resolution.defectTier ?? "");
    if (!isItemDisputeDefectTier(tierRaw)) continue;
    const tier = tierRaw as ItemDisputeDefectTier;

    const stripeInvoiceId = String(resolution.stripeInvoiceId ?? "").trim() || null;
    const stripeHostedInvoiceUrl =
      String(resolution.stripeHostedInvoiceUrl ?? "").trim() || null;
    const cartDisputeId =
      typeof row.cart_dispute_id === "string" ? row.cart_dispute_id : null;
    const cartId = cartDisputeId ? cartIdByDispute.get(cartDisputeId) ?? null : null;

    const groupKey = stripeInvoiceId || `solo:${row.id}`;
    if (seenInvoiceKeys.has(groupKey)) continue;
    seenInvoiceKeys.add(groupKey);

    const lineItemsFromAlert = Array.isArray(alert?.lineItems) ? alert!.lineItems! : [];
    let lineItems: MemberItemDisputePaymentGateLine[] = [];
    if (lineItemsFromAlert.length > 0) {
      lineItems = lineItemsFromAlert.map((l) => {
        const pts = Math.max(0, Math.round(Number(l.billedPoints ?? 0)));
        return {
          itemDisputeId: String(l.itemDisputeId ?? "").trim(),
          itemTitle: String(l.itemTitle ?? "pièce").trim() || "pièce",
          billedPoints: pts,
          billingPercent: Math.max(0, Math.round(Number(l.billingPercent ?? 0))),
          amountLabel: formatItemDisputePointsEuros(pts),
        };
      });
    } else if (stripeInvoiceId) {
      for (const r of rows ?? []) {
        const res =
          r.resolution && typeof r.resolution === "object" && !Array.isArray(r.resolution)
            ? (r.resolution as ResolutionShape)
            : null;
        if (!res || !isUnpaidChargeStatus(res.chargeStatus)) continue;
        if (String(res.stripeInvoiceId ?? "").trim() !== stripeInvoiceId) continue;
        const a = res.memberAlert ?? res.member_alert ?? null;
        const pts = Math.max(0, Math.round(Number(res.billedPoints ?? 0)));
        if (pts <= 0) continue;
        lineItems.push({
          itemDisputeId: r.id as string,
          itemTitle: String(a?.itemTitle ?? "pièce").split(",")[0]?.trim() || "pièce",
          billedPoints: pts,
          billingPercent: Math.max(0, Math.round(Number(res.billingPercent ?? 0))),
          amountLabel: formatItemDisputePointsEuros(pts),
        });
      }
    }

    const billedPoints = Math.max(
      0,
      Math.round(
        Number(
          alert?.billedPoints ??
            (lineItems.length > 0
              ? lineItems.reduce((s, l) => s + l.billedPoints, 0)
              : resolution.billedPoints) ??
            0,
        ),
      ),
    );
    if (billedPoints <= 0) continue;

    const billingPercent = Math.max(
      0,
      Math.round(Number(alert?.billingPercent ?? resolution.billingPercent ?? 0)),
    );
    const itemTitle =
      String(alert?.itemTitle ?? "").trim() ||
      (lineItems.length > 0
        ? lineItems.map((l) => l.itemTitle).join(", ")
        : "ta pièce");

    const title =
      String(alert?.title ?? "").trim() ||
      (lineItems.length > 1
        ? `${lineItems.length} pièces — règlement requis`
        : `${itemDisputeDefectTierLabel(tier)} — règlement requis`);
    const body =
      String(alert?.body ?? "").trim() ||
      `Une facturation liée à « ${itemTitle} » est en attente de règlement. Le litige pièce sera résolu dès réception du paiement.`;

    return {
      kind: "payment",
      itemDisputeId: row.id as string,
      cartId,
      cartDisputeId,
      tier,
      tierLabel: itemDisputeDefectTierLabel(tier),
      title,
      body,
      itemTitle,
      billedPoints,
      billingPercent,
      amountLabel: formatItemDisputePointsEuros(billedPoints),
      amountCents: billedPoints * 100,
      chargeStatus: resolution.chargeStatus,
      stripeInvoiceId,
      stripeHostedInvoiceUrl,
      dismissible: Boolean(resolution.paymentGateDismissible),
      commandeHref: cartId ? `/commande/${cartId}` : null,
      empruntHref: cartId ? `/exchange/emprunt/${cartId}` : null,
      lineItems: lineItems.length > 1 ? lineItems : undefined,
    };
  }

  // Suspension soft ops (sans facture) — après les gates paiement.
  // Uniquement litiges ouverts : la clôture doit lever la modale
  // (et clear `ops_soft_gate` côté ops / resolve).
  const { data: softRows } = await admin
    .from("cart_disputes")
    .select("id, cart_id, ops_soft_gate, status, updated_at")
    .in("id", cdIds)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .order("updated_at", { ascending: false })
    .limit(40);

  for (const row of softRows ?? []) {
    const soft = parseCartDisputeOpsSoftGate(row.ops_soft_gate);
    if (!soft.active) continue;
    const cartDisputeId = row.id as string;
    const cartId =
      (typeof row.cart_id === "string" ? row.cart_id : null) ??
      cartIdByDispute.get(cartDisputeId) ??
      null;
    return {
      kind: "ops_soft",
      itemDisputeId: `ops-soft:${cartDisputeId}`,
      cartId,
      cartDisputeId,
      tier: null,
      tierLabel: "Suspension temporaire",
      title: "Accès temporairement restreint",
      body: "Un litige est en cours de traitement sur ta commande. Consulte ton dossier ou contacte l’assistance Segna pour avancer.",
      itemTitle: "ton litige",
      billedPoints: 0,
      billingPercent: 0,
      amountLabel: "",
      amountCents: 0,
      chargeStatus: "ops_soft",
      stripeInvoiceId: null,
      stripeHostedInvoiceUrl: null,
      dismissible: soft.dismissible,
      commandeHref: cartId ? `/commande/${cartId}` : null,
      empruntHref: cartId ? `/exchange/emprunt/${cartId}` : null,
    };
  }

  return null;
}
