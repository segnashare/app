import Image from "next/image";
import Link from "next/link";

import { EmpruntBorrowRemainingCountdown } from "@/components/emprunt/EmpruntBorrowRemainingCountdown";
import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type EmpruntBorrowSummarySectionProps = {
  cartId: string;
  /** Heure de livraison aller (`shipments.updated_at`) pour le décompte d’emprunt. */
  deliveredAtIso: string | null;
  returnCommitmentMet?: boolean;
  membershipLabel: SegnaBorrowMembershipLabel;
};

const BODY_GRAY = "text-[#545454]";

const btnPrimary = cn(
  segnaMontserrat.className,
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-full bg-black px-4 py-2.5 text-center text-[15px] font-bold leading-none text-white transition hover:bg-zinc-900 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);
const btnSecondary = cn(
  segnaMontserrat.className,
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-full border border-black bg-white px-4 py-2.5 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);

/**
 * Bloc « Gère ton panier » sous le header (style empty-state Uber : Montserrat, noir / gris).
 */
export function EmpruntBorrowSummarySection({
  cartId,
  deliveredAtIso,
  returnCommitmentMet,
  membershipLabel,
}: EmpruntBorrowSummarySectionProps) {
  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-col items-center border-b border-zinc-100 px-5 pb-6 pt-3 text-center",
      )}
      aria-labelledby="emprunt-borrow-summary-title"
    >
      <div className="relative mx-auto w-full max-w-[220px] shrink-0">
        <Image
          src="/ressources/oeil_charme.png"
          alt=""
          width={480}
          height={480}
          className="mx-auto h-auto w-full max-h-[180px] object-contain"
        />
      </div>
      <h2
        id="emprunt-borrow-summary-title"
        className="mt-5 max-w-[20rem] text-[22px] font-bold leading-tight tracking-tight text-black sm:text-[24px]"
      >
        Gère ton panier
      </h2>
      <div className="mt-3 max-w-[22rem] space-y-2">
        {deliveredAtIso ? (
          <EmpruntBorrowRemainingCountdown
            deliveredAtIso={deliveredAtIso}
            returnCommitmentMet={returnCommitmentMet}
            membershipLabel={membershipLabel}
          />
        ) : (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_GRAY)}>
            {membershipLabel === "Guest"
              ? "Emprunt de 10 jours à partir de la livraison."
              : `Emprunt d'un mois à partir de la livraison.`}
          </p>
        )}
        <p className={cn("text-[15px] font-normal leading-relaxed", BODY_GRAY)}>
          Prolonge ou renvoie ton panier quand tu veux.
        </p>
      </div>
      <div className="mt-8 flex w-full max-w-md flex-row items-stretch justify-center gap-2 sm:gap-2.5">
        <Link href={`/commande/${cartId}/prolonger`} className={btnSecondary}>
          Prolonger
        </Link>
        <Link href={`/exchange/retour/${cartId}`} className={btnPrimary}>
          Retourner
        </Link>
      </div>
    </section>
  );
}
