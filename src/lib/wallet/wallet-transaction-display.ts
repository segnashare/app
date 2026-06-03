export type WalletRecentTransaction = {
  id: string;
  createdAt: string;
  direction: "credit" | "debit";
  amountPoints: number;
  label: string;
  subtitle: string | null;
  isAdminAdjustment?: boolean;
};

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
    return { label: "Crédits prêt", subtitle: "Pièce validée", isAdminAdjustment: false };
  }
  if (source === "return_verification_ok") {
    return { label: "Retour validé", subtitle: "Crédits rendus", isAdminAdjustment: false };
  }
  if (source === "cart_order_stripe") {
    return { label: "Emprunt", subtitle: "Réservation panier", isAdminAdjustment: false };
  }
  if (source === "credits_purchase") {
    return { label: "Complément panier", subtitle: null, isAdminAdjustment: false };
  }
  if (source === "subscription_monthly_consumption_grant") {
    return { label: "Crédits Segna", subtitle: "Renouvellement mensuel", isAdminAdjustment: false };
  }
  if (source === "onboarding_welcome_gift") {
    return { label: "Cadeau de bienvenue", subtitle: null, isAdminAdjustment: false };
  }
  if (source.includes("borrow_overdue") || source.includes("overdue")) {
    return { label: "Retard de retour", subtitle: null, isAdminAdjustment: false };
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
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTx = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfTx.getTime()) / 86_400_000);
  if (dayDiff === 0) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Hier";
  if (dayDiff < 7) {
    return date.toLocaleDateString("fr-FR", { weekday: "long" });
  }
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
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
