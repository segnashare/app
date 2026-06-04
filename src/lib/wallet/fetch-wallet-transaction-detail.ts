import {
  fetchMemberCartOrderDetail,
  type MemberCartOrderLine,
} from "@/lib/cart/fetch-member-cart-order-detail";
import { isHttpUrl, resolveItemPhotoData } from "@/lib/cart/fetch-active-cart-lines";
import { createSignedUrlsForStoragePaths, type StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";
import {
  WALLET_ADMIN_ADJUSTMENT_SUBTITLE,
  walletTransactionDisplayLabel,
} from "@/lib/wallet/wallet-transaction-display";

export type WalletTransactionDetailLine = Pick<
  MemberCartOrderLine,
  "id" | "itemId" | "itemName" | "brand" | "description" | "pricePoints" | "photoUrl" | "photoPosition"
>;

export type WalletTransactionDetailSummaryRow = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export type WalletTransactionDetail = {
  id: string;
  createdAt: string;
  direction: "credit" | "debit";
  amountPoints: number;
  label: string;
  source: string;
  statusLine: string;
  occurredAtFormatted: string;
  contextHint: string | null;
  cartContext: {
    cartId: string;
    orderNumberCompact: string;
    commandeHref: string;
    lines: WalletTransactionDetailLine[];
    totalPoints: number;
    creditsDebited: number;
    euroTotalPaid: number | null;
  } | null;
  returnContext: {
    cartId: string;
    orderNumberCompact: string;
    commandeHref: string;
    creditsReturned: number;
    creditsConsumedOnOrder: number;
    lines: WalletTransactionDetailLine[];
  } | null;
  lendContext: {
    itemId: string;
    itemHref: string;
    line: WalletTransactionDetailLine;
  } | null;
  isAdminAdjustment: boolean;
  adminNotice: string | null;
  summaryRows: WalletTransactionDetailSummaryRow[];
};

type SupabaseLike = StorageSignClient & {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq?: (column: string, value: unknown) => unknown;
        is?: (column: string, value: unknown) => unknown;
        filter?: (column: string, operator: string, value: unknown) => unknown;
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
        order?: (column: string, options?: { ascending?: boolean }) => unknown;
      };
    };
  };
};

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLineForSource(source: string, cartStatus?: string | null): string {
  const s = source.toLowerCase();
  if (s === "cart_order_stripe") {
    if (cartStatus === "archived") return "État : emprunt terminé";
    if (cartStatus === "canceled") return "État : commande annulée";
    return "État : emprunt en cours";
  }
  if (s === "return_verification_ok") return "État : retour validé";
  if (s === "lend_intake_verified") return "État : prêt validé";
  if (s === "modif_admin") return "État : ajustement admin Segna";
  if (s.includes("cancel") || s.includes("refund")) return "État : crédits rendus";
  if (s === "subscription_monthly_consumption_grant") return "État : crédits mensuels";
  if (s === "onboarding_included_credits" || s === "onboarding_welcome_gift") {
    return "État : crédits inclus activés";
  }
  if (s === "subscription_monthly_consumption") return "État : crédits inclus du mois";
  if (s.includes("referral")) return "État : parrainage";
  if (s.includes("overdue")) return "État : pénalité retard";
  return "État : enregistré";
}

async function sumCartDebitPoints(
  supabase: SupabaseLike,
  userId: string,
  cartId: string,
): Promise<number> {
  const res = await (supabase as any)
    .from("wallet_transactions")
    .select("amount_points, credit_bucket, metadata")
    .eq("user_id", userId)
    .eq("kind", "debit")
    .eq("direction", "debit")
    .filter("metadata->>source", "eq", "cart_order_stripe")
    .filter("metadata->>cart_id", "eq", cartId);

  const rows = (res.data ?? []) as {
    amount_points: number;
    credit_bucket: string | null;
    metadata: Record<string, unknown> | null;
  }[];

  let total = 0;
  for (const row of rows) {
    const splitRaw = row.metadata?.debit_split;
    if (splitRaw && typeof splitRaw === "object" && !Array.isArray(splitRaw)) {
      const s = splitRaw as Record<string, unknown>;
      total +=
        Math.max(0, Math.floor(Number(s.exchange_points ?? 0))) +
        Math.max(0, Math.floor(Number(s.consumption_points ?? 0)));
    } else {
      total += Math.max(0, Math.floor(Number(row.amount_points ?? 0)));
    }
  }
  return total;
}

async function fetchItemLine(
  supabase: SupabaseLike,
  itemId: string,
  ownerUserId: string,
): Promise<WalletTransactionDetailLine | null> {
  const res = await (supabase as any)
    .from("items")
    .select(
      "id, title, description, price_points, photos, owner_user_id, item_custom_brand_label, item_brands(label)",
    )
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  const item = res.data as {
    id: string;
    title?: string | null;
    description?: string | null;
    price_points?: number | null;
    photos?: unknown;
    owner_user_id?: string;
    item_custom_brand_label?: string | null;
    item_brands?: { label?: string | null } | null;
  } | null;

  if (!item || item.owner_user_id !== ownerUserId) return null;

  const photoData = resolveItemPhotoData(item.photos ?? null);
  let photoUrl: string | null = null;
  if (photoData.path) {
    if (isHttpUrl(photoData.path)) {
      photoUrl = photoData.path;
    } else {
      const signed = await createSignedUrlsForStoragePaths(supabase, [photoData.path], 60 * 60);
      photoUrl = signed.get(photoData.path) ?? null;
    }
  }

  return {
    id: item.id,
    itemId: item.id,
    itemName: item.title?.trim() || "Pièce sans titre",
    brand:
      (typeof item.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      item.item_brands?.label?.trim() ||
      null,
    description: item.description?.trim() || null,
    pricePoints: Math.max(0, Math.floor(Number(item.price_points ?? 0))),
    photoUrl,
    photoPosition: photoData.position,
  };
}

function mapOrderLines(lines: MemberCartOrderLine[]): WalletTransactionDetailLine[] {
  return lines.map((line) => ({
    id: line.id,
    itemId: line.itemId,
    itemName: line.itemName,
    brand: line.brand,
    description: line.description,
    pricePoints: line.pricePoints,
    photoUrl: line.photoUrl,
    photoPosition: line.photoPosition,
  }));
}

export async function fetchWalletTransactionDetail(
  supabase: SupabaseLike,
  userId: string,
  transactionId: string,
): Promise<WalletTransactionDetail | null> {
  const txRes = await (supabase as any)
    .from("wallet_transactions")
    .select("id, created_at, direction, amount_points, kind, credit_bucket, metadata, idempotency_key")
    .eq("id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();

  const tx = txRes.data as {
    id: string;
    created_at: string;
    direction: string;
    amount_points: number;
    metadata: Record<string, unknown> | null;
    idempotency_key?: string | null;
  } | null;

  if (!tx) return null;

  const meta = tx.metadata ?? {};
  const idempotencyKey = typeof tx.idempotency_key === "string" ? tx.idempotency_key : null;
  const source = readMetaString(meta, "source")?.toLowerCase() ?? "";
  const { label, subtitle, isAdminAdjustment } = walletTransactionDisplayLabel(meta, idempotencyKey);
  const direction = tx.direction === "credit" ? "credit" : "debit";
  const amountPoints = Math.max(0, Math.floor(Number(tx.amount_points ?? 0)));
  const cartId = readMetaString(meta, "cart_id");
  const itemId = readMetaString(meta, "item_id");

  let cartContext: WalletTransactionDetail["cartContext"] = null;
  let returnContext: WalletTransactionDetail["returnContext"] = null;
  let lendContext: WalletTransactionDetail["lendContext"] = null;
  let cartStatus: string | null = null;

  if (cartId) {
    const order = await fetchMemberCartOrderDetail(supabase as never, userId, cartId, "exchange");
    if (order) {
      cartStatus = order.cartStatus;
      const euroTotalPaid = order.paymentBreakdown?.euroDetail?.totalPaidEuros ?? null;
      const creditsDebited = order.pointsPaidSplit?.totalPoints ?? order.totalPoints;

      if (source === "cart_order_stripe") {
        cartContext = {
          cartId,
          orderNumberCompact: order.orderNumberCompact,
          commandeHref: `/commande/${cartId}`,
          lines: mapOrderLines(order.lines),
          totalPoints: order.totalPoints,
          creditsDebited,
          euroTotalPaid: euroTotalPaid != null && euroTotalPaid > 0 ? euroTotalPaid : null,
        };
      }

      if (source === "return_verification_ok" || source.includes("cancel") || source.includes("refund")) {
        const consumed = await sumCartDebitPoints(supabase, userId, cartId);
        returnContext = {
          cartId,
          orderNumberCompact: order.orderNumberCompact,
          commandeHref: `/commande/${cartId}`,
          creditsReturned: amountPoints,
          creditsConsumedOnOrder: consumed > 0 ? consumed : order.totalPoints,
          lines: mapOrderLines(order.lines),
        };
      }
    }
  }

  if (source === "lend_intake_verified" && itemId) {
    const line = await fetchItemLine(supabase, itemId, userId);
    if (line) {
      lendContext = {
        itemId,
        itemHref: `/items/${itemId}?from=wallet`,
        line,
      };
    }
  }

  const summaryRows: WalletTransactionDetailSummaryRow[] = [];
  const adminNotice = isAdminAdjustment
    ? "Ajustement manuel effectué par l'équipe Segna. Cette opération est indépendante d'un emprunt, d'un prêt ou d'un renouvellement automatique."
    : null;

  if (isAdminAdjustment) {
    summaryRows.push(
      { label: "Origine", value: "Équipe admin Segna", emphasize: true },
      {
        label: "Type d'opération",
        value: direction === "credit" ? "Crédit ajouté manuellement" : "Crédit retiré manuellement",
      },
      {
        label: "Montant",
        value: `${direction === "credit" ? "+" : "−"}${amountPoints.toLocaleString("fr-FR")} crédits`,
        emphasize: true,
      },
    );
  }

  if (returnContext) {
    summaryRows.push({
      label: "Crédits utilisés pour l'emprunt",
      value: `${returnContext.creditsConsumedOnOrder.toLocaleString("fr-FR")} crédits`,
    });
    summaryRows.push({
      label: "Crédits rendus",
      value: `${returnContext.creditsReturned.toLocaleString("fr-FR")} crédits`,
      emphasize: true,
    });
    if (returnContext.creditsReturned === returnContext.creditsConsumedOnOrder) {
      summaryRows.push({
        label: "Solde",
        value: "Intégralité des crédits de l'emprunt rendue",
      });
    } else if (returnContext.creditsReturned < returnContext.creditsConsumedOnOrder) {
      summaryRows.push({
        label: "Solde",
        value: `${(returnContext.creditsConsumedOnOrder - returnContext.creditsReturned).toLocaleString("fr-FR")} crédits non rendus`,
      });
    }
  }

  if (cartContext) {
    summaryRows.push({
      label: "Crédits prélevés",
      value: `${cartContext.creditsDebited.toLocaleString("fr-FR")} crédits`,
      emphasize: true,
    });
    if (cartContext.euroTotalPaid != null) {
      summaryRows.push({
        label: "Complément payé",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          cartContext.euroTotalPaid,
        ),
      });
    }
    summaryRows.push({
      label: "Commande",
      value: `#${cartContext.orderNumberCompact}`,
    });
  }

  if (lendContext) {
    summaryRows.push({
      label: "Pièce prêtée",
      value: lendContext.line.itemName,
    });
    summaryRows.push({
      label: "Crédits gagnés",
      value: `${lendContext.line.pricePoints.toLocaleString("fr-FR")} crédits`,
      emphasize: true,
    });
  }

  if (!isAdminAdjustment && summaryRows.length === 0) {
    if (subtitle) {
      summaryRows.push({ label: "Détail", value: subtitle });
    }
    const displayAmountPoints =
      source === "cart_order_stripe" && cartContext != null ? cartContext.creditsDebited : amountPoints;
    summaryRows.push({
      label: "Montant",
      value: `${direction === "credit" ? "+" : "−"}${displayAmountPoints.toLocaleString("fr-FR")} crédits`,
      emphasize: true,
    });
  }

  const displayAmountPoints =
    source === "cart_order_stripe" && cartContext != null ? cartContext.creditsDebited : amountPoints;

  const contextHint = isAdminAdjustment
    ? WALLET_ADMIN_ADJUSTMENT_SUBTITLE
    : returnContext != null
      ? `Commande #${returnContext.orderNumberCompact}`
      : cartContext != null
        ? `Commande #${cartContext.orderNumberCompact}`
        : lendContext != null
          ? lendContext.line.itemName
          : subtitle;

  return {
    id: tx.id,
    createdAt: tx.created_at,
    direction,
    amountPoints: displayAmountPoints,
    label,
    source,
    statusLine: isAdminAdjustment ? "État : ajustement admin Segna" : statusLineForSource(source, cartStatus),
    occurredAtFormatted: formatOccurredAt(tx.created_at),
    contextHint,
    cartContext,
    returnContext,
    lendContext,
    isAdminAdjustment,
    adminNotice,
    summaryRows,
  };
}
