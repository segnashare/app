import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartTotalLossHistoryCart } from "@/lib/disputes/cart-total-loss";
import {
  formatItemDisputePointsEuros,
  isItemDisputeDefectTier,
  itemDisputeDefectTierLabel,
  type ItemDisputeDefectTier,
} from "@/lib/disputes/item-dispute-defect-scale";
import {
  isItemDisputeDisposition,
  itemDisputeDispositionLabel,
  type ItemDisputeDisposition,
} from "@/lib/disputes/item-dispute-policy";
import {
  memberItemDisputeSettlementKind,
  type MemberItemDisputeSettlementKind,
} from "@/lib/disputes/member-item-dispute-settlement-display";

export type MemberCartTotalLossPieceResolution = {
  itemDisputeId: string;
  cartDisputeId: string | null;
  itemId: string;
  itemTitle: string;
  /** Perte vs défaut — pour pastille / résumé par article. */
  outcomeKind: MemberItemDisputeSettlementKind;
  tier: ItemDisputeDefectTier | null;
  tierLabel: string | null;
  billedPoints: number;
  amountLabel: string | null;
  chargeStatus: string | null;
  chargeStatusLabel: string | null;
  disposition: ItemDisputeDisposition | null;
  dispositionLabel: string | null;
  stripeHostedInvoiceUrl: string | null;
  paidAt: string | null;
  resolvedAt: string | null;
};

export type MemberCartTotalLossResolution = {
  isTotalLossHistory: boolean;
  cartDisputeId: string | null;
  pieces: MemberCartTotalLossPieceResolution[];
  totalBilledPoints: number;
  totalAmountLabel: string | null;
};

function chargeStatusLabelFr(status: string | null): string | null {
  switch (status) {
    case "paid":
      return "Payé";
    case "invoiced":
      return "Facture émise";
    case "failed":
      return "Échec paiement";
    case "none":
    case "recorded":
      return "Enregistré";
    default:
      return status;
  }
}

type ResolutionShape = {
  chargeStatus?: string;
  disposition?: string;
  stripeHostedInvoiceUrl?: string | null;
  defectTier?: string;
  billedPoints?: number;
  paidAt?: string | null;
  resolvedAt?: string | null;
};

/**
 * Résolutions litige pièce (clos) pour un panier — y compris panier mixte.
 * `isTotalLossHistory` = toutes les lignes perdues + commande archivée.
 */
export async function fetchMemberCartTotalLossResolution(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
  opts?: { cartStatus?: string | null; hasOpenDispute?: boolean },
): Promise<MemberCartTotalLossResolution> {
  const empty: MemberCartTotalLossResolution = {
    isTotalLossHistory: false,
    cartDisputeId: null,
    pieces: [],
    totalBilledPoints: 0,
    totalAmountLabel: null,
  };

  const uid = userId.trim();
  const cid = cartId.trim();
  if (!uid || !cid) return empty;

  const { data: lines } = await admin
    .from("cart_items")
    .select("item_id, dispute_line_status")
    .eq("cart_id", cid)
    .is("deleted_at", null);

  const lineStatuses = (lines ?? []).map(
    (r: { dispute_line_status?: string | null }) => r.dispute_line_status,
  );

  let cartStatus = opts?.cartStatus ?? null;
  if (cartStatus == null) {
    const { data: cart } = await admin
      .from("carts")
      .select("status")
      .eq("id", cid)
      .eq("user_id", uid)
      .maybeSingle();
    cartStatus = typeof cart?.status === "string" ? cart.status : null;
  }

  const isTotalLossHistory = isCartTotalLossHistoryCart({
    cartStatus,
    lineStatuses,
    hasOpenDispute: opts?.hasOpenDispute === true,
  });

  // Inclure aussi open/in_review : pastilles Perte/Défaut dès qu’une pièce est classée,
  // même si le dossier panier n’est pas encore clôturé.
  const { data: cartDisputes } = await admin
    .from("cart_disputes")
    .select("id")
    .eq("cart_id", cid)
    .eq("opened_by_user_id", uid)
    .is("deleted_at", null)
    .in("status", ["open", "in_review", "resolved", "closed"])
    .order("updated_at", { ascending: false })
    .limit(12);

  const disputeIds = (cartDisputes ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter(Boolean);

  if (disputeIds.length === 0) {
    return { ...empty, isTotalLossHistory };
  }

  const { data: itemDisputes } = await admin
    .from("item_disputes")
    .select("id, item_id, status, resolution, updated_at, cart_dispute_id")
    .in("cart_dispute_id", disputeIds)
    .is("deleted_at", null)
    .in("status", ["resolved", "closed"])
    .order("updated_at", { ascending: false })
    .limit(80);

  const itemIds = [
    ...new Set(
      (itemDisputes ?? [])
        .map((r) => (typeof r.item_id === "string" ? r.item_id : ""))
        .filter(Boolean),
    ),
  ];
  const titleByItem = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items } = await admin.from("items").select("id, title").in("id", itemIds);
    for (const it of items ?? []) {
      if (typeof it.id === "string") {
        titleByItem.set(it.id, typeof it.title === "string" && it.title.trim() ? it.title.trim() : "Pièce");
      }
    }
  }

  const seenItems = new Set<string>();
  const pieces: MemberCartTotalLossPieceResolution[] = [];
  for (const row of itemDisputes ?? []) {
    const itemId = typeof row.item_id === "string" ? row.item_id : "";
    if (!itemId || seenItems.has(itemId)) continue;
    seenItems.add(itemId);

    const res =
      row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
        ? (row.resolution as ResolutionShape)
        : {};
    const tierRaw = typeof res.defectTier === "string" ? res.defectTier : "";
    const tier = isItemDisputeDefectTier(tierRaw) ? tierRaw : null;
    const billedPoints =
      typeof res.billedPoints === "number" && Number.isFinite(res.billedPoints)
        ? Math.max(0, Math.round(res.billedPoints))
        : 0;
    const dispositionRaw = typeof res.disposition === "string" ? res.disposition : "";
    const disposition = isItemDisputeDisposition(dispositionRaw) ? dispositionRaw : null;
    const chargeStatus = typeof res.chargeStatus === "string" ? res.chargeStatus : null;
    const invoiceUrl =
      typeof res.stripeHostedInvoiceUrl === "string" && res.stripeHostedInvoiceUrl.trim()
        ? res.stripeHostedInvoiceUrl.trim()
        : null;
    const outcomeKind = memberItemDisputeSettlementKind({
      tier,
      disposition,
    });

    pieces.push({
      itemDisputeId: String(row.id),
      cartDisputeId: typeof row.cart_dispute_id === "string" ? row.cart_dispute_id : null,
      itemId,
      itemTitle: titleByItem.get(itemId) ?? "Pièce",
      outcomeKind,
      tier,
      tierLabel: tier ? itemDisputeDefectTierLabel(tier) : null,
      billedPoints,
      amountLabel: billedPoints > 0 ? formatItemDisputePointsEuros(billedPoints) : null,
      chargeStatus,
      chargeStatusLabel: chargeStatusLabelFr(chargeStatus),
      disposition,
      dispositionLabel: disposition ? itemDisputeDispositionLabel(disposition) : null,
      stripeHostedInvoiceUrl: invoiceUrl,
      paidAt: typeof res.paidAt === "string" ? res.paidAt : null,
      resolvedAt:
        typeof res.resolvedAt === "string"
          ? res.resolvedAt
          : typeof row.updated_at === "string"
            ? row.updated_at
            : null,
    });
  }

  const totalBilledPoints = pieces.reduce((sum, p) => sum + p.billedPoints, 0);
  return {
    isTotalLossHistory,
    cartDisputeId: disputeIds[0] ?? null,
    pieces,
    totalBilledPoints,
    totalAmountLabel:
      totalBilledPoints > 0 ? formatItemDisputePointsEuros(totalBilledPoints) : null,
  };
}
