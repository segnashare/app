import {
  isHiddenWalletTransactionRow,
  walletTransactionDisplayLabel,
  type WalletRecentTransaction,
} from "@/lib/wallet/wallet-transaction-display";

export type WalletTransactionAnnouncement = Pick<
  WalletRecentTransaction,
  "id" | "createdAt" | "direction" | "amountPoints" | "label" | "subtitle"
>;

export function isWalletTransactionAnnouncementSkipped(
  metadata: Record<string, unknown> | null | undefined,
  idempotencyKey?: string | null,
): boolean {
  if (isHiddenWalletTransactionRow(idempotencyKey)) return true;
  const source = String(metadata?.source ?? "")
    .trim()
    .toLowerCase();
  if (source.includes("referral")) return true;
  return false;
}

export function walletTransactionAnnouncementTitle(): string {
  return "Transaction";
}

export function formatWalletTransactionSignedAmount(
  direction: WalletTransactionAnnouncement["direction"],
  amountPoints: number,
): string {
  const pts = Math.max(0, Math.trunc(amountPoints));
  return direction === "credit" ? `+${pts}` : `−${pts}`;
}

export function walletTransactionAnnouncementSignedAmount(tx: WalletTransactionAnnouncement): string {
  return formatWalletTransactionSignedAmount(tx.direction, tx.amountPoints);
}

export function walletTransactionAnnouncementBody(tx: WalletTransactionAnnouncement): string {
  const sub = tx.subtitle?.trim();
  if (tx.direction === "credit") {
    if (sub) {
      return `${tx.label}. ${sub}. Tes crédits ont été ajoutés à ton wallet.`;
    }
    return `${tx.label}. Tes crédits ont été ajoutés à ton wallet.`;
  }
  if (sub) {
    return `${tx.label}. ${sub}. Ton wallet a été débité.`;
  }
  return `${tx.label}. Ton wallet a été débité.`;
}

export function walletTransactionAnnouncementCta(tx: WalletTransactionAnnouncement): string {
  return tx.direction === "credit" ? "Voir mon wallet" : "Compris";
}

export function pickLatestWalletTransactionAnnouncement(
  rows: Array<
    Pick<WalletRecentTransaction, "id" | "createdAt" | "direction" | "amountPoints"> & {
      label?: string;
      subtitle?: string | null;
      idempotency_key?: string | null;
      metadata?: Record<string, unknown> | null;
    }
  >,
): WalletTransactionAnnouncement | null {
  const visible = rows.filter(
    (row) => !isWalletTransactionAnnouncementSkipped(row.metadata, row.idempotency_key),
  );
  const latest = visible[0];
  if (!latest) return null;
  const display =
    latest.label != null
      ? { label: latest.label, subtitle: latest.subtitle ?? null }
      : walletTransactionDisplayLabel(latest.metadata, latest.idempotency_key);
  return {
    id: latest.id,
    createdAt: latest.createdAt,
    direction: latest.direction,
    amountPoints: latest.amountPoints,
    label: display.label,
    subtitle: display.subtitle,
  };
}
