import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import { walletCreditKindLabel } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

/** Icône Segna pour les crédits de consommation — `public/ressources/icons/segna.svg`. */
const SEGNA_CONSUMPTION_ICON_SRC = "/ressources/icons/segna.svg";

type SegnaPointsUnitDisplayProps = {
  points: number;
  creditKind: WalletCreditKind;
  className?: string;
  numberClassName?: string;
};

/**
 * Montant + icône Segna (consommation), ou montant + libellé « crédits d'échange ».
 */
export function SegnaPointsUnitDisplay({
  points,
  creditKind,
  className,
  numberClassName,
}: SegnaPointsUnitDisplayProps) {
  const n = Math.floor(points);
  const formatted = n.toLocaleString("fr-FR");
  const unitLabel = walletCreditKindLabel(creditKind);
  const showConsumptionIcon = creditKind === "consumption";
  const consumptionAriaLabel = `${formatted} ${n === 1 ? "point" : "points"} Segna de consommation`;

  return (
    <span
      className={cn("inline-flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5", className)}
      aria-label={showConsumptionIcon ? consumptionAriaLabel : `${formatted} ${unitLabel}`}
    >
      <span className={cn("tabular-nums", numberClassName)} aria-hidden>
        {formatted}
      </span>
      {showConsumptionIcon ? (
        <img
          src={SEGNA_CONSUMPTION_ICON_SRC}
          alt=""
          width={18}
          height={18}
          className="h-[1.15em] w-[1.15em] shrink-0 self-center object-contain"
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

/** Icône `segna.svg` seule — pour phrases (« X … couverts ») où l’unité consommation est déjà implicite. */
export function SegnaConsumptionCreditPhrase({ className, textClassName }: SegnaConsumptionCreditPhraseProps) {
  return (
    <span className={cn("inline-flex items-center", className, textClassName)} aria-hidden>
      <img
        src={SEGNA_CONSUMPTION_ICON_SRC}
        alt=""
        width={14}
        height={14}
        className="h-[1.1em] w-[1.1em] shrink-0 object-contain"
        aria-hidden
      />
    </span>
  );
}
