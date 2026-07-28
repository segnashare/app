import { walletBonusCreditsAriaLabel, type WalletCreditKind } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

type SegnaPointsUnitDisplayProps = {
  points: number;
  creditKind: WalletCreditKind;
  className?: string;
  numberClassName?: string;
  iconClassName?: string;
  /**
   * Conservé pour compat : l’affichage est désormais en euros (plus de jeton / logo crédit).
   */
  unitDisplay?: "label" | "icon";
  /**
   * Conservé pour compat (plus d’icône teintée).
   */
  iconColor?: "fixed" | "current";
};

function formatEuroFromPoints(points: number): string {
  const n = Number.isFinite(points) ? Math.floor(points) : 0;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Montant wallet / panier en euros (1 point = 1 €). Plus de « coin » Segna.
 */
export function SegnaPointsUnitDisplay({
  points,
  creditKind,
  className,
  numberClassName,
}: SegnaPointsUnitDisplayProps) {
  const n = Number.isFinite(points) ? Math.floor(points) : 0;
  const formatted = formatEuroFromPoints(n);
  const ariaLabel =
    creditKind === "consumption" ? walletBonusCreditsAriaLabel(n) : `${formatted} d’échange`;

  return (
    <span
      className={cn("inline-flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5", className)}
      aria-label={ariaLabel}
    >
      <span className={cn("tabular-nums", numberClassName)}>{formatted}</span>
    </span>
  );
}

type SegnaConsumptionCreditPhraseProps = {
  className?: string;
  /** Taille / graisse alignées sur le texte environnant (ex. text-[12px] text-zinc-500). */
  textClassName?: string;
};

/** Libellé « € » — remplace l’ancien logotype crédits bonus. */
export function SegnaConsumptionCreditPhrase({ className, textClassName }: SegnaConsumptionCreditPhraseProps) {
  return (
    <span className={cn("inline-flex items-center tabular-nums", className, textClassName)} aria-hidden>
      €
    </span>
  );
}

/** Libellé « € » — remplace l’ancien jeton crédit dans une phrase. */
export function SegnaExchangeCreditPhrase({ className, textClassName }: SegnaConsumptionCreditPhraseProps) {
  return (
    <span className={cn("inline-flex items-center tabular-nums", className, textClassName)} aria-hidden>
      €
    </span>
  );
}
