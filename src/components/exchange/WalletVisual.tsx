"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

import { SEGNA_BRAND_LOGO_SRC, SEGNA_CREDIT_ICON_SRC } from "@/lib/brand/segna-mark";
import { cn } from "@/lib/utils/cn";

import styles from "./WalletVisual.module.css";

export type WalletInfoSegment = {
  text: string;
  strong?: boolean;
};

export const DEFAULT_WALLET_INFO_COPY: WalletInfoSegment[][] = [
  [
    { text: "Pour valider un panier, tu peux combiner tes " },
    { text: "Crédits d’échange", strong: true },
    { text: " (gagnés en prêtant tes pièces) et tes " },
    { text: "Crédits Segna", strong: true },
    { text: " (achetés ou gagnés dans l’app)." },
  ],
  [
    { text: "À la fin de l’échange, tes " },
    { text: "Crédits d’échange", strong: true },
    { text: " te sont " },
    { text: "rendus", strong: true },
    { text: " sur ton wallet, alors que tes " },
    { text: "Crédits Segna", strong: true },
    { text: " sont " },
    { text: "définitivement consommés", strong: true },
    { text: "." },
  ],
];

type WalletVisualProps = {
  availablePoints: number;
  balanceConsumptionPoints: number;
  balanceExchangePoints: number;
  infoCopy?: WalletInfoSegment[][];
  /** Remet l’état (cartes / retournement) quand le panneau se ferme. */
  open?: boolean;
  className?: string;
};

function WalletInfoText({ copy }: { copy: WalletInfoSegment[][] }) {
  return (
    <div className="space-y-3 text-center text-[12px] leading-relaxed text-zinc-300 sm:text-[13px]">
      {copy.map((line, lineIndex) => (
        <p key={lineIndex}>
          {line.map((segment, segmentIndex) =>
            segment.strong ? (
              <strong key={`${lineIndex}-${segmentIndex}`} className="font-semibold text-white">
                {segment.text}
              </strong>
            ) : (
              <span key={`${lineIndex}-${segmentIndex}`}>{segment.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export function WalletVisual({
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  infoCopy = DEFAULT_WALLET_INFO_COPY,
  open = true,
  className,
}: WalletVisualProps) {
  const [cardsExpanded, setCardsExpanded] = useState(false);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!open) {
      setCardsExpanded(false);
      setFlipped(false);
    }
  }, [open]);

  return (
    <div className={cn(styles.scene, className)}>
      <div className={cn(styles.flipper, flipped && styles.flipperFlipped)}>
        <div className={cn(styles.face, styles.wallet, cardsExpanded && styles.walletExpanded)}>
          <div className={cn(styles.cardsStack, cardsExpanded && styles.cardsStackExpanded)} aria-hidden={flipped}>
            <div className={cn(styles.creditCard, styles.creditCardExchange)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-white/75">Crédits d&apos;échange</p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums leading-none">
                    {balanceExchangePoints}
                    <span className="ml-1 text-[13px] font-semibold text-white/80">pts</span>
                  </p>
                </div>
                <img src={SEGNA_CREDIT_ICON_SRC} alt="" className="h-5 w-5 shrink-0 object-contain brightness-0 invert" />
              </div>
            </div>

            <div className={cn(styles.creditCard, styles.creditCardSegna)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Crédits Segna</p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums leading-none text-zinc-950">
                    {balanceConsumptionPoints}
                    <span className="ml-1 text-[13px] font-semibold text-zinc-500">pts</span>
                  </p>
                </div>
                <img src={SEGNA_BRAND_LOGO_SRC} alt="" className="h-5 w-auto max-w-[3.25rem] shrink-0 object-contain" />
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            className={styles.walletBody}
            aria-expanded={cardsExpanded}
            aria-label={cardsExpanded ? "Replier les cartes du wallet" : "Afficher les cartes du wallet"}
            onClick={() => setCardsExpanded((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCardsExpanded((current) => !current);
              }
            }}
          >
            <div className={styles.walletFooter}>
              <div>
                <p className="text-[26px] font-bold tabular-nums leading-none text-white">
                  {availablePoints}
                  <span className="ml-1 text-[15px] font-semibold text-zinc-400">pts</span>
                </p>
                <p className="mt-1.5 text-[13px] font-medium text-zinc-500">Total utilisable</p>
              </div>

              <button
                type="button"
                className={styles.infoButton}
                aria-label={flipped ? "Revenir au wallet" : "Informations sur les crédits"}
                aria-pressed={flipped}
                onClick={(event) => {
                  event.stopPropagation();
                  setFlipped((current) => !current);
                }}
              >
                <Info className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>

        <div className={cn(styles.face, styles.back, styles.backPanel)}>
          <WalletInfoText copy={infoCopy} />
          <button
            type="button"
            className={cn(styles.infoButton, "absolute bottom-5 right-5")}
            aria-label="Revenir au wallet"
            onClick={() => setFlipped(false)}
          >
            <Info className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
