import {
  isHiddenWalletTransactionRow,
  walletTransactionDisplayLabel,
  type WalletRecentTransaction,
} from "@/lib/wallet/wallet-transaction-display";

export type WalletTransactionAnnouncement = Pick<
  WalletRecentTransaction,
  "id" | "createdAt" | "direction" | "amountPoints" | "label" | "subtitle"
> & {
  source?: string | null;
  planCode?: string | null;
};

const SEGNAX_WELCOME_SOURCES = new Set([
  "subscription_monthly_consumption_grant",
  "subscription_monthly_consumption",
]);

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

export function isSegnaXWelcomeAnnouncement(tx: WalletTransactionAnnouncement | null | undefined): boolean {
  if (!tx || tx.direction !== "credit") return false;
  const source = (tx.source ?? "").trim().toLowerCase();
  if (!SEGNAX_WELCOME_SOURCES.has(source)) return false;
  const plan = (tx.planCode ?? "").trim().toLowerCase();
  // Grant mensuel SegnaX (ou sans plan_code si le flux ne le pose pas).
  return plan === "segna_x" || plan === "" || plan === "segnax";
}

/** Copie « Bienvenue Segna X » (checkout / 1ʳᵉ visite) — pas les renouvellements mensuels. */
export function shouldUseSegnaXWelcomeCopy(
  tx: WalletTransactionAnnouncement | null | undefined,
  opts: { forceWelcome: boolean; welcomeAlreadySeen: boolean },
): boolean {
  if (!isSegnaXWelcomeAnnouncement(tx)) return false;
  return opts.forceWelcome || !opts.welcomeAlreadySeen;
}

export function walletTransactionAnnouncementTitle(
  tx?: WalletTransactionAnnouncement | null,
  opts?: { welcomeCopy?: boolean },
): string {
  if (opts?.welcomeCopy && isSegnaXWelcomeAnnouncement(tx)) return "Bienvenue dans Segna X 🎉";
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

export function walletTransactionAnnouncementBody(
  tx: WalletTransactionAnnouncement,
  opts?: { welcomeCopy?: boolean },
): string {
  if (opts?.welcomeCopy && isSegnaXWelcomeAnnouncement(tx)) {
    return "Ton abonnement est activé. Tes 400 € de crédits mensuels sont déjà dans ton wallet, prêts à être dépensés.";
  }
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

export function walletTransactionAnnouncementAmountCaption(
  tx: WalletTransactionAnnouncement,
  opts?: { welcomeCopy?: boolean },
): string | null {
  if (opts?.welcomeCopy && isSegnaXWelcomeAnnouncement(tx)) return "Crédits disponibles ce mois-ci";
  return null;
}

export function walletTransactionAnnouncementCta(
  tx: WalletTransactionAnnouncement,
  opts?: { welcomeCopy?: boolean },
): string {
  if (opts?.welcomeCopy && isSegnaXWelcomeAnnouncement(tx)) return "Découvrir le catalogue";
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
  const sourceRaw = latest.metadata?.source;
  const planRaw = latest.metadata?.plan_code ?? latest.metadata?.planCode;
  return {
    id: latest.id,
    createdAt: latest.createdAt,
    direction: latest.direction,
    amountPoints: latest.amountPoints,
    label: display.label,
    subtitle: display.subtitle,
    source: typeof sourceRaw === "string" ? sourceRaw : null,
    planCode: typeof planRaw === "string" ? planRaw : null,
  };
}
