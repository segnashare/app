import { walletBonusCreditsAriaLabel, type WalletCreditKind } from "@/lib/wallet/credit-kind";
import { SEGNA_BRAND_LOGO_SRC, SEGNA_CREDIT_ICON_SRC } from "@/lib/brand/segna-mark";
import { cn } from "@/lib/utils/cn";

const SEGNA_CONSUMPTION_ICON_SRC = SEGNA_BRAND_LOGO_SRC;
const SEGNA_CREDIT_TOKEN_ICON_SRC = SEGNA_CREDIT_ICON_SRC;

type SegnaPointsUnitDisplayProps = {
  points: number;
  creditKind: WalletCreditKind;
  className?: string;
  numberClassName?: string;
  iconClassName?: string;
  /**
   * `label` : bonus (seau consumption) → logotype Segna ; échange → jeton crédit (`icon/segan.svg`).
   * `icon` : chiffre + jeton crédit (détail commande / total).
   */
  unitDisplay?: "label" | "icon";
  /**
   * `fixed` : couleurs du fichier SVG.
   * `current` : jeton teinté via `currentColor` (frames CMS fond coloré).
   */
  iconColor?: "fixed" | "current";
};

const segnaCreditTokenMaskStyle = {
  maskImage: `url(${SEGNA_CREDIT_TOKEN_ICON_SRC})`,
  WebkitMaskImage: `url(${SEGNA_CREDIT_TOKEN_ICON_SRC})`,
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "left center",
  WebkitMaskPosition: "left center",
} as const;

/**
 * Montant + unité visuelle : logotype Segna (crédits bonus) ou jeton crédit (échange / mode icon).
 */
export function SegnaPointsUnitDisplay({
  points,
  creditKind,
  className,
  numberClassName,
  iconClassName,
  unitDisplay = "label",
  iconColor = "fixed",
}: SegnaPointsUnitDisplayProps) {
  const n = Number.isFinite(points) ? Math.floor(points) : 0;
  const formatted = n.toLocaleString("fr-FR");
  const exchangeAriaLabel = `${formatted} ${n === 1 ? "crédit" : "crédits"}`;
  const iconMode = unitDisplay === "icon";
  const useCreditTokenIcon = iconMode || creditKind === "exchange";
  const ariaLabel = creditKind === "consumption" ? walletBonusCreditsAriaLabel(n) : exchangeAriaLabel;

  return (
    <span
      className={cn("inline-flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5", className)}
      aria-label={ariaLabel}
    >
      <span className={cn("tabular-nums", numberClassName)} aria-hidden>
        {formatted}
      </span>
      {iconMode && iconColor === "current" ? (
        <span
          className={cn(
            "inline-block shrink-0 self-center bg-current",
            "h-[1.05em] w-[1.05em]",
            iconClassName,
          )}
          style={segnaCreditTokenMaskStyle}
          aria-hidden
        />
      ) : (
        <img
          src={useCreditTokenIcon ? SEGNA_CREDIT_TOKEN_ICON_SRC : SEGNA_CONSUMPTION_ICON_SRC}
          alt=""
          className={cn(
            "w-auto shrink-0 self-center object-contain object-left",
            useCreditTokenIcon ? "h-[1.05em] max-w-[2.75rem]" : "h-[1.15em] max-w-[4rem]",
            iconClassName,
          )}
          aria-hidden
        />
      )}
    </span>
  );
}

type SegnaConsumptionCreditPhraseProps = {
  className?: string;
  /** Taille / graisse alignées sur le texte environnant (ex. text-[12px] text-zinc-500). */
  textClassName?: string;
};

/** Logotype Segna seul — crédits bonus (seau consumption). */
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

/** Jeton crédit seul — remplace le mot « crédits » dans une phrase. */
export function SegnaExchangeCreditPhrase({ className, textClassName }: SegnaConsumptionCreditPhraseProps) {
  return (
    <span className={cn("inline-flex items-center", className, textClassName)} aria-hidden>
      <img
        src={SEGNA_CREDIT_TOKEN_ICON_SRC}
        alt=""
        className="h-[1.1em] w-auto max-w-[2.75rem] shrink-0 object-contain object-left"
        aria-hidden
      />
    </span>
  );
}
