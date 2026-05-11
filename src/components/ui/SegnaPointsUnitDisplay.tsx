import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import { SEGNA_BRAND_LOGO_SRC } from "@/lib/brand/segna-mark";
import { walletCreditKindLabel } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

const SEGNA_CONSUMPTION_ICON_SRC = SEGNA_BRAND_LOGO_SRC;

type SegnaPointsUnitDisplayProps = {
  points: number;
  creditKind: WalletCreditKind;
  className?: string;
  numberClassName?: string;
  /**
   * `label` : consommation → icône Segna ; échange → libellé « crédits d'échange ».
   * `icon` : toujours chiffre + `icons/segna.svg` (détail commande / total).
   */
  unitDisplay?: "label" | "icon";
};

/**
 * Montant + icône Segna (consommation), ou montant + libellé « crédits d'échange ».
 */
export function SegnaPointsUnitDisplay({
  points,
  creditKind,
  className,
  numberClassName,
  unitDisplay = "label",
}: SegnaPointsUnitDisplayProps) {
  const n = Math.floor(points);
  const formatted = n.toLocaleString("fr-FR");
  const unitLabel = walletCreditKindLabel(creditKind);
  const showConsumptionIcon = creditKind === "consumption";
  const consumptionAriaLabel = `${formatted} ${n === 1 ? "point" : "points"} Segna de consommation`;
  const exchangeAriaLabel = `${formatted} ${n === 1 ? "crédit" : "crédits"} d'échange`;
  const iconMode = unitDisplay === "icon";

  return (
    <span
      className={cn("inline-flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5", className)}
      aria-label={
        iconMode
          ? creditKind === "consumption"
            ? consumptionAriaLabel
            : exchangeAriaLabel
          : showConsumptionIcon
            ? consumptionAriaLabel
            : `${formatted} ${unitLabel}`
      }
    >
      <span className={cn("tabular-nums", numberClassName)} aria-hidden>
        {formatted}
      </span>
      {iconMode || showConsumptionIcon ? (
        <img
          src={SEGNA_CONSUMPTION_ICON_SRC}
          alt=""
          className="h-[1.15em] w-auto max-w-[4rem] shrink-0 self-center object-contain object-left"
          aria-hidden
        />
      ) : (
        <span className={cn("max-w-[9rem] text-left text-[11px] font-semibold leading-tight", numberClassName)}>
          {unitLabel}
        </span>
      )}
    </span>
  );
}

type SegnaConsumptionCreditPhraseProps = {
  className?: string;
  /** Taille / graisse alignées sur le texte environnant (ex. text-[12px] text-zinc-500). */
  textClassName?: string;
};

/** Logotype Segna seul — pour phrases (« X … couverts ») où l’unité consommation est déjà implicite. */
export function SegnaConsumptionCreditPhrase({ className, textClassName }: SegnaConsumptionCreditPhraseProps) {
  return (
    <span className={cn("inline-flex items-center", className, textClassName)} aria-hidden>
      <img
        src={SEGNA_CONSUMPTION_ICON_SRC}
        alt=""
        className="h-[1.1em] w-auto max-w-[3.5rem] shrink-0 object-contain object-left"
        aria-hidden
      />
    </span>
  );
}
