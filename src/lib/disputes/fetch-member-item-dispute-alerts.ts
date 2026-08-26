import type { SupabaseClient } from "@supabase/supabase-js";

import { getSegnaSupportContact } from "@/lib/config/support-contact";
import {
  formatItemDisputePointsEuros,
  isItemDisputeDefectTier,
  itemDisputeDefectTierLabel,
  type ItemDisputeDefectTier,
} from "@/lib/disputes/item-dispute-defect-scale";
import {
  isItemDisputeDisposition,
  type ItemDisputeDisposition,
} from "@/lib/disputes/item-dispute-policy";

export type MemberItemDisputeAlertLine = {
  itemDisputeId: string;
  itemTitle: string;
  billedPoints: number;
  billingPercent: number;
  amountLabel: string;
};

export type MemberItemDisputeAlert = {
  itemDisputeId: string;
  cartDisputeId: string | null;
  cartId: string | null;
  cartLabel: string | null;
  tier: ItemDisputeDefectTier;
  tierLabel: string;
  title: string;
  body: string;
  summary: string;
  billedPoints: number;
  billingPercent: number;
  itemTitle: string;
  amountLabel: string | null;
  amountLine: string | null;
  chargeStatus: string | null;
  paymentLabel: string | null;
  statusLabel: string;
  comment: string | null;
  disposition: ItemDisputeDisposition | null;
  dispositionLabel: string | null;
  stripeHostedInvoiceUrl: string | null;
  returnHref: string | null;
  commandeHref: string | null;
  contestMailHref: string;
  lineItems?: MemberItemDisputeAlertLine[];
  siblingItemDisputeIds?: string[];
};

type ResolutionShape = {
  chargeStatus?: string;
  disposition?: string;
  outcomeFamily?: string;
  stripeHostedInvoiceUrl?: string | null;
  defectTier?: string;
  billedPoints?: number;
  billingPercent?: number;
  note?: string | null;
  stripeInvoiceId?: string | null;
  memberAlert?: {
    status?: string;
    tier?: string;
    title?: string;
    body?: string;
    billedPoints?: number;
    billingPercent?: number;
    itemTitle?: string;
    lineItems?: Array<{
      itemDisputeId?: string;
      itemTitle?: string;
      billedPoints?: number;
      billingPercent?: number;
    }>;
    siblingItemDisputeIds?: string[];
  } | null;
  member_alert?: {
    status?: string;
    tier?: string;
    title?: string;
    body?: string;
    billedPoints?: number;
    billingPercent?: number;
    itemTitle?: string;
    lineItems?: Array<{
      itemDisputeId?: string;
      itemTitle?: string;
      billedPoints?: number;
      billingPercent?: number;
    }>;
    siblingItemDisputeIds?: string[];
  } | null;
};

/** « Collier en cœur APC » → « collier en cœur APC » pour les phrases. */
function softLowerFirst(value: string): string {
  const s = value.trim();
  if (!s) return s;
  return s.charAt(0).toLocaleLowerCase("fr-FR") + s.slice(1);
}

function cartLabelFromId(cartId: string | null): string | null {
  if (!cartId) return null;
  return `Commande ${cartId.slice(0, 8).toUpperCase()}`;
}

function statusLabelFor(
  tier: ItemDisputeDefectTier,
  disposition: ItemDisputeDisposition | null,
): string {
  if (disposition === "lost_not_returned" || tier === "non_return") {
    return "Retour non reçu";
  }
  if (disposition === "return_to_segna") return "Pièce à renvoyer";
  if (tier === "minor") return "Avertissement";
  if (tier === "small_irreversible" || tier === "major_irreversible") {
    return "Défaut constaté";
  }
  return itemDisputeDefectTierLabel(tier);
}

function paymentLabelFor(chargeStatus: string | null, billedPoints: number): string | null {
  if (billedPoints <= 0) return "Aucun";
  if (chargeStatus === "paid") return "Confirmé";
  if (chargeStatus === "invoiced") return "En cours";
  if (chargeStatus === "failed") return "Échoué";
  return null;
}

function amountLineFor(amountLabel: string | null, billingPercent: number): string | null {
  if (!amountLabel) return null;
  if (billingPercent > 0 && billingPercent < 100) {
    return `${amountLabel} (${billingPercent} %)`;
  }
  if (billingPercent === 100) return `${amountLabel} (100 %)`;
  return amountLabel;
}

function buildAlertCopy(input: {
  tier: ItemDisputeDefectTier;
  disposition: ItemDisputeDisposition | null;
  chargeStatus: string | null;
  amountLabel: string | null;
  itemTitle: string;
  billingPercent: number;
}): { title: string; summary: string } {
  const titleRaw = input.itemTitle.trim() || "ta pièce";
  const piece = softLowerFirst(titleRaw);
  const paid = input.chargeStatus === "paid";

  if (input.tier === "non_return" || input.disposition === "lost_not_returned") {
    return {
      title: `Le ${piece} n’a pas été retourné`,
      summary:
        paid && input.amountLabel
          ? `Le délai de retour est terminé. Conformément à nos conditions, ${input.amountLabel} ont été prélevés pour le ${piece}.`
          : `Le délai de retour est terminé. Conformément à nos conditions, le ${piece} est considéré comme non retourné.`,
    };
  }

  if (input.disposition === "return_to_segna") {
    return {
      title: `Le ${piece} doit être renvoyé`,
      summary: paid && input.amountLabel
        ? `Conformément à nos conditions, ${input.amountLabel} ont été prélevés. Merci de renvoyer encore cette pièce à Segna.`
        : `Cette pièce doit être renvoyée à Segna. Ouvre ta commande pour démarrer le retour.`,
    };
  }

  if (input.tier === "minor") {
    return {
      title: `Avertissement sur le ${piece}`,
      summary: `Un défaut minime a été constaté sur le ${piece}. Aucun montant n’a été prélevé.`,
    };
  }

  if (input.tier === "small_irreversible" || input.tier === "major_irreversible") {
    const pct =
      input.billingPercent > 0 ? ` (${input.billingPercent} % de la valeur)` : "";
    return {
      title: `Défaut constaté sur le ${piece}`,
      summary:
        paid && input.amountLabel
          ? `Conformément à nos conditions, ${input.amountLabel}${pct} ont été prélevés pour le ${piece}.`
          : `Un défaut a été constaté sur le ${piece}. Une participation${pct} peut être facturée.`,
    };
  }

  return {
    title: `Mise à jour sur le ${piece}`,
    summary: paid && input.amountLabel
      ? `Conformément à nos conditions, ${input.amountLabel} ont été prélevés pour le ${piece}.`
      : `Ton litige concernant le ${piece} a été traité.`,
  };
}

/**
 * Alertes litige pièce en attente d’accusé (bottom sheet clôture).
 */
export async function fetchMemberPendingItemDisputeAlerts(
  admin: SupabaseClient,
  userId: string,
): Promise<MemberItemDisputeAlert[]> {
  const uid = userId.trim();
  if (!uid) return [];

  const { data: cartDisputes } = await admin
    .from("cart_disputes")
    .select("id, cart_id")
    .eq("opened_by_user_id", uid)
    .is("deleted_at", null)
    .limit(80);

  const cdIds = (cartDisputes ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : ""))
    .filter(Boolean);
  if (cdIds.length === 0) return [];

  const cartIdByDispute = new Map<string, string>();
  for (const r of cartDisputes ?? []) {
    if (typeof r.id === "string" && typeof r.cart_id === "string") {
      cartIdByDispute.set(r.id, r.cart_id);
    }
  }

  const { data: rows } = await admin
    .from("item_disputes")
    .select("id, cart_dispute_id, resolution, status")
    .in("cart_dispute_id", cdIds)
    .is("deleted_at", null)
    .in("status", ["resolved", "closed"])
    .order("updated_at", { ascending: false })
    .limit(40);

  const out: MemberItemDisputeAlert[] = [];
  const seenGroup = new Set<string>();

  for (const row of rows ?? []) {
    const resolution =
      row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
        ? (row.resolution as ResolutionShape)
        : null;
    const alert = resolution?.memberAlert ?? resolution?.member_alert ?? null;
    if (!alert || alert.status !== "pending") continue;
    if (!isItemDisputeDefectTier(String(alert.tier ?? resolution?.defectTier ?? ""))) continue;

    const chargeStatus = String(resolution?.chargeStatus ?? "").toLowerCase() || null;
    const billedPoints = Math.max(
      0,
      Math.round(Number(alert.billedPoints ?? resolution?.billedPoints ?? 0)),
    );
    // Facturation impayée → gate paiement bloquant (pas cette sheet).
    if (
      billedPoints > 0 &&
      (chargeStatus === "invoiced" || chargeStatus === "failed" || chargeStatus === "recorded")
    ) {
      continue;
    }

    const stripeInvoiceId = String(resolution?.stripeInvoiceId ?? "").trim();
    const siblingIds = Array.isArray(alert.siblingItemDisputeIds)
      ? alert.siblingItemDisputeIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const groupKey =
      siblingIds.length > 1
        ? `sib:${[...siblingIds].sort().join(",")}`
        : stripeInvoiceId
          ? `inv:${stripeInvoiceId}`
          : `solo:${row.id}`;
    if (seenGroup.has(groupKey)) continue;
    seenGroup.add(groupKey);

    const tier = (alert.tier ?? resolution?.defectTier) as ItemDisputeDefectTier;
    const lineItemsRaw = Array.isArray(alert.lineItems) ? alert.lineItems : [];
    const lineItems: MemberItemDisputeAlertLine[] = lineItemsRaw.map((l) => {
      const pts = Math.max(0, Math.round(Number(l.billedPoints ?? 0)));
      return {
        itemDisputeId: String(l.itemDisputeId ?? "").trim(),
        itemTitle: String(l.itemTitle ?? "pièce").trim() || "pièce",
        billedPoints: pts,
        billingPercent: Math.max(0, Math.round(Number(l.billingPercent ?? 0))),
        amountLabel: formatItemDisputePointsEuros(pts),
      };
    });
    const itemTitle =
      String(alert.itemTitle ?? "").trim() ||
      (lineItems.length > 0
        ? lineItems.map((l) => l.itemTitle).join(", ")
        : "ta pièce");
    const cartDisputeId = typeof row.cart_dispute_id === "string" ? row.cart_dispute_id : null;
    const cartId = cartDisputeId ? cartIdByDispute.get(cartDisputeId) ?? null : null;
    const disposition = isItemDisputeDisposition(String(resolution?.disposition ?? ""))
      ? (resolution!.disposition as ItemDisputeDisposition)
      : null;
    const amountLabel = billedPoints > 0 ? formatItemDisputePointsEuros(billedPoints) : null;
    const billingPercent = Math.max(
      0,
      Math.round(Number(alert.billingPercent ?? resolution?.billingPercent ?? 0)),
    );
    const stripeHostedInvoiceUrl =
      String(resolution?.stripeHostedInvoiceUrl ?? "").trim() || null;
    const comment =
      typeof resolution?.note === "string" && resolution.note.trim()
        ? resolution.note.trim()
        : null;
    const copy =
      lineItems.length > 1
        ? {
            title:
              String(alert.title ?? "").trim() ||
              (tier === "non_return"
                ? `${lineItems.length} pièces n’ont pas été retournées`
                : `Mise à jour sur ${lineItems.length} pièces`),
            summary:
              String(alert.body ?? "").trim().split("\n\n")[0] ||
              (amountLabel
                ? `Conformément à nos conditions, ${amountLabel} ont été prélevés pour ${lineItems.length} pièces.`
                : `Ton litige concernant ${lineItems.length} pièces a été traité.`),
          }
        : buildAlertCopy({
            tier,
            disposition,
            chargeStatus,
            amountLabel,
            itemTitle,
            billingPercent,
          });
    const cartLabel = cartLabelFromId(cartId);
    const supportEmail = getSegnaSupportContact().email ?? "contact@segnashare.com";
    const contestSubject = `Contestation litige — ${itemTitle}${
      cartLabel ? ` (${cartLabel})` : ""
    }`;

    out.push({
      itemDisputeId: row.id as string,
      cartDisputeId,
      cartId,
      cartLabel,
      tier,
      tierLabel: itemDisputeDefectTierLabel(tier),
      title: copy.title,
      body: String(alert.body ?? "").trim(),
      summary: copy.summary,
      billedPoints,
      billingPercent,
      itemTitle,
      amountLabel,
      amountLine: amountLineFor(amountLabel, billingPercent),
      chargeStatus,
      paymentLabel: paymentLabelFor(chargeStatus, billedPoints),
      statusLabel:
        lineItems.length > 1
          ? tier === "non_return"
            ? "Retours non reçus"
            : statusLabelFor(tier, disposition)
          : statusLabelFor(tier, disposition),
      comment,
      disposition,
      dispositionLabel: null,
      stripeHostedInvoiceUrl,
      returnHref: cartId && disposition === "return_to_segna" ? `/exchange/retour/${cartId}` : null,
      commandeHref: cartId ? `/commande/${cartId}` : null,
      contestMailHref: `mailto:${supportEmail}?subject=${encodeURIComponent(contestSubject)}`,
      lineItems: lineItems.length > 1 ? lineItems : undefined,
      siblingItemDisputeIds:
        siblingIds.length > 1 ? siblingIds : lineItems.length > 1
          ? lineItems.map((l) => l.itemDisputeId).filter(Boolean)
          : undefined,
    });
  }
  return out;
}

export async function acknowledgeMemberItemDisputeAlert(
  admin: SupabaseClient,
  userId: string,
  itemDisputeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await admin
    .from("item_disputes")
    .select("id, cart_dispute_id, resolution")
    .eq("id", itemDisputeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row?.id) return { ok: false, error: "introuvable" };

  const { data: cd } = await admin
    .from("cart_disputes")
    .select("opened_by_user_id")
    .eq("id", row.cart_dispute_id)
    .maybeSingle();
  if (cd?.opened_by_user_id !== userId) return { ok: false, error: "interdit" };

  const resolution =
    row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
      ? { ...(row.resolution as Record<string, unknown>) }
      : {};
  const memberAlert =
    resolution.memberAlert && typeof resolution.memberAlert === "object"
      ? { ...(resolution.memberAlert as Record<string, unknown>) }
      : resolution.member_alert && typeof resolution.member_alert === "object"
        ? { ...(resolution.member_alert as Record<string, unknown>) }
        : null;
  if (!memberAlert || memberAlert.status !== "pending") {
    return { ok: true };
  }

  const siblingIds = Array.isArray(memberAlert.siblingItemDisputeIds)
    ? (memberAlert.siblingItemDisputeIds as unknown[])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
    : [];
  const idsToAck = [...new Set([row.id as string, ...siblingIds])];
  const nowIso = new Date().toISOString();

  for (const id of idsToAck) {
    const { data: sibling } = await admin
      .from("item_disputes")
      .select("id, resolution")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!sibling?.id) continue;
    const sibRes =
      sibling.resolution && typeof sibling.resolution === "object" && !Array.isArray(sibling.resolution)
        ? { ...(sibling.resolution as Record<string, unknown>) }
        : {};
    const sibAlert =
      sibRes.memberAlert && typeof sibRes.memberAlert === "object"
        ? { ...(sibRes.memberAlert as Record<string, unknown>) }
        : sibRes.member_alert && typeof sibRes.member_alert === "object"
          ? { ...(sibRes.member_alert as Record<string, unknown>) }
          : null;
    if (!sibAlert || sibAlert.status !== "pending") continue;
    const nextResolution = {
      ...sibRes,
      memberAlert: {
        ...sibAlert,
        status: "acked",
        ackedAt: nowIso,
      },
    };
    delete (nextResolution as { member_alert?: unknown }).member_alert;
    await admin
      .from("item_disputes")
      .update({ resolution: nextResolution, updated_at: nowIso })
      .eq("id", sibling.id);
  }
  return { ok: true };
}
