const STORAGE_KEY_PREFIX = "segna_wallet_tx_ack_v1";

export type WalletTransactionAckState = {
  lastAcknowledgedTransactionId: string | null;
  lastAcknowledgedAt: string;
};

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function readWalletTransactionAckState(userId: string): WalletTransactionAckState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletTransactionAckState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      lastAcknowledgedTransactionId:
        typeof parsed.lastAcknowledgedTransactionId === "string" ? parsed.lastAcknowledgedTransactionId : null,
      lastAcknowledgedAt:
        typeof parsed.lastAcknowledgedAt === "string" ? parsed.lastAcknowledgedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeWalletTransactionAckState(userId: string, state: WalletTransactionAckState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

/** Première visite : baseline silencieuse pour ne pas annoncer l’historique. */
export function ensureWalletTransactionAckBaseline(
  userId: string,
  latestTransactionId: string | null,
  latestCreatedAt: string,
): void {
  if (readWalletTransactionAckState(userId) != null) return;
  writeWalletTransactionAckState(userId, {
    lastAcknowledgedTransactionId: latestTransactionId,
    lastAcknowledgedAt: latestCreatedAt || new Date().toISOString(),
  });
}

export function shouldAnnounceWalletTransaction(
  userId: string,
  transactionId: string,
): boolean {
  const ack = readWalletTransactionAckState(userId);
  if (!ack) return false;
  return ack.lastAcknowledgedTransactionId !== transactionId;
}

export function acknowledgeWalletTransaction(
  userId: string,
  transactionId: string,
  createdAt: string,
): void {
  writeWalletTransactionAckState(userId, {
    lastAcknowledgedTransactionId: transactionId,
    lastAcknowledgedAt: createdAt,
  });
}
