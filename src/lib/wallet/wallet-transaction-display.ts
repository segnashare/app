import { formatDateParis } from "@/lib/datetime/segna-datetime";
import { parisCalendarDateString } from "@/lib/emprunt/borrow-overdue-penalty";
import { sortWalletTransactionsNewestFirst } from "@/lib/wallet/wallet-transaction-sort";

export type WalletRecentTransaction = {
  id: string;
  createdAt: string;
  direction: "credit" | "debit";
  amountPoints: number;
  balanceBeforePoints: number;
  label: string;
  subtitle: string | null;
  isAdminAdjustment?: boolean;
};

export function walletTransactionSignedDelta(
  direction: WalletRecentTransaction["direction"],
  amountPoints: number,
): number {
  const amount = Math.max(0, Math.trunc(amountPoints));
  return direction === "credit" ? amount : -amount;
}

export function walletTransactionBalanceAfter(
  balanceBeforePoints: number,
  direction: WalletRecentTransaction["direction"],
  amountPoints: number,
): number {
  return balanceBeforePoints + walletTransactionSignedDelta(direction, amountPoints);
}

/** Transactions triées du plus récent au plus ancien ; `currentBalancePoints` = solde après la tx la plus récente. */
export function attachWalletTransactionBalances<
  T extends Pick<WalletRecentTransaction, "direction" | "amountPoints" | "createdAt" | "id"> & {
    idempotency_key?: string | null;
    metadata?: Record<string, unknown> | null;
    credit_bucket?: string | null;
  },
>(transactions: T[], currentBalancePoints: number): (T & { balanceBeforePoints: number })[] {
  let balanceAfter = Math.max(0, Math.trunc(currentBalancePoints));

  const sorted = sortWalletTransactionsNewestFirst(transactions);

  return sorted.map((tx) => {
    const delta = walletTransactionSignedDelta(tx.direction, tx.amountPoints);
    const balanceBefore = balanceAfter - delta;
    const next = { ...tx, balanceBeforePoints: balanceBefore };
    balanceAfter = balanceBefore;
    return next;
  });
}

export const WALLET_ADMIN_ADJUSTMENT_LABEL = "Ajustement Segna";
export const WALLET_ADMIN_ADJUSTMENT_SUBTITLE = "Action manuelle de l'équipe admin";

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export function isAdminWalletTransaction(
  metadata: Record<string, unknown> | null | undefined,
  idempotencyKey?: string | null,
): boolean {
  const source = readMetaString(metadata, "source")?.toLowerCase() ?? "";
  if (source === "modif_admin") return true;
  const sourceType = readMetaString(metadata, "source_type")?.toLowerCase() ?? "";
  if (sourceType === "backoffice") return true;
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (key.startsWith("modif_admin:")) return true;
  return false;
}

/** Complément panier Stripe (legacy) + anciens bonus parrainage : masqués dans l’historique wallet. */
export function isHiddenWalletTransactionRow(idempotencyKey?: string | null): boolean {
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (key.startsWith("stripe:cart_order_wallet:")) return true;
  if (key.startsWith("referral_signup_bonus:")) return true;
  return false;
}

function cartBorrowDisplayGroupKey(row: {
  direction: string;
  metadata?: Record<string, unknown> | null;
  idempotency_key?: string | null;
}): string | null {
  if (row.direction !== "debit") return null;
  const source = readMetaString(row.metadata, "source")?.toLowerCase() ?? "";
  if (source !== "cart_order_stripe") return null;

  const cartId = readMetaString(row.metadata, "cart_id");
  if (cartId) return `cart:${cartId}`;

  const key = (row.idempotency_key ?? "").trim();
  if (!key) return null;
  return `key:${key.replace(/:(exchange|consumption)$/, "")}`;
}

/** Regroupe les débits emprunt mixtes (bonus + échange) en une seule ligne affichée. */
export function mergeCartBorrowWalletDisplayRows<
  T extends Pick<WalletRecentTransaction, "id" | "createdAt" | "direction" | "amountPoints"> & {
    idempotency_key?: string | null;
    metadata?: Record<string, unknown> | null;
    credit_bucket?: string | null;
  },
>(rows: T[]): T[] {
  const grouped = new Map<string, T[]>();
  const passthrough: T[] = [];

  for (const row of rows) {
    const groupKey = cartBorrowDisplayGroupKey(row);
    if (!groupKey) {
      passthrough.push(row);
      continue;
    }
    const bucket = grouped.get(groupKey) ?? [];
    bucket.push(row);
    grouped.set(groupKey, bucket);
  }

  const mergedGroups: T[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      mergedGroups.push(group[0]!);
      continue;
    }

    const primary =
      group.find((row) => (row.credit_bucket ?? "").trim().toLowerCase() === "exchange") ?? group[0]!;
    const totalAmount = group.reduce((sum, row) => sum + Math.max(0, Math.trunc(row.amountPoints)), 0);

    mergedGroups.push({
      ...primary,
      amountPoints: totalAmount,
    });
  }

  return [...passthrough, ...mergedGroups];
}

export function walletTransactionDisplayLabel(
  metadata: Record<string, unknown> | null | undefined,
  idempotencyKey?: string | null,
): {
  label: string;
  subtitle: string | null;
  isAdminAdjustment: boolean;
} {
  if (isAdminWalletTransaction(metadata, idempotencyKey)) {
    return {
      label: WALLET_ADMIN_ADJUSTMENT_LABEL,
      subtitle: WALLET_ADMIN_ADJUSTMENT_SUBTITLE,
      isAdminAdjustment: true,
    };
  }

  const source = readMetaString(metadata, "source")?.toLowerCase() ?? "";

  if (source === "lend_intake_verified") {
    return { label: "Crédits prêt", subtitle: "Réception Segna validée", isAdminAdjustment: false };
  }
  if (source === "return_verification_ok") {
    return { label: "Retour validé", subtitle: "Crédits rendus", isAdminAdjustment: false };
  }
  if (source === "cart_order_stripe") {
    return { label: "Emprunt", subtitle: "Paiement panier", isAdminAdjustment: false };
  }
  if (source === "credits_purchase") {
    return { label: "Complément panier", subtitle: null, isAdminAdjustment: false };
  }
  if (source === "subscription_monthly_consumption_grant" || source === "subscription_monthly_consumption") {
    const plan = readMetaString(metadata, "plan_code")?.toLowerCase();
    const subtitle =
      plan === "guest" ? "Crédits inclus (profil Guest)" : "Crédits inclus du mois";
    return { label: "Crédits inclus", subtitle, isAdminAdjustment: false };
  }
  if (source === "onboarding_included_credits" || source === "onboarding_welcome_gift") {
    return { label: "Crédits inclus", subtitle: "Activation onboarding", isAdminAdjustment: false };
  }
  if (source.includes("borrow_overdue") || source.includes("overdue")) {
    return { label: "Pénalité de retard", subtitle: "Retour non déposé à temps", isAdminAdjustment: false };
  }
  if (source.includes("referral")) {
    return { label: "Parrainage", subtitle: null, isAdminAdjustment: false };
  }
  if (source.includes("refund") || source.includes("cancel")) {
    return { label: "Annulation", subtitle: "Crédits rendus", isAdminAdjustment: false };
  }

  return { label: "Mouvement wallet", subtitle: null, isAdminAdjustment: false };
}

export function formatWalletTransactionWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const todayKey = parisCalendarDateString();
  const txKey = parisCalendarDateString(date.getTime());
  if (txKey === todayKey) {
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    });
  }
  const dayDiff = Math.round((Date.parse(todayKey) - Date.parse(txKey)) / 86_400_000);
  if (dayDiff === 1) return "Hier";
  if (dayDiff > 1 && dayDiff < 7) {
    return formatDateParis(date, { weekday: "long" });
  }
  return formatDateParis(date, { day: "numeric", month: "short" });
}

export function formatWalletTransactionListDetailLine(
  subtitle: string | null | undefined,
  when: string,
): string {
  const sub = subtitle?.trim() ?? "";
  if (!sub) return when;
  if (sub === when) return when;
  return `${sub} · ${when}`;
}

export function formatWalletTransactionAmount(direction: string, amountPoints: number): string {
  const pts = Math.max(0, Math.trunc(amountPoints));
  if (direction === "credit") {
    return `+${pts}`;
  }
  return `−${pts}`;
}
