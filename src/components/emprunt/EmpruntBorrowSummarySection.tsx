"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";
import { isBorrowReturnAlertPhaseParis } from "@/lib/cart/borrow-return-calendar";
import type { MemberCartBorrowOverdueSnapshot } from "@/lib/cart/fetch-member-cart-borrow-overdue";
import { EmpruntBorrowOverdueSection } from "@/components/emprunt/EmpruntBorrowOverdueSection";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type EmpruntBorrowSummarySectionProps = {
  cartId: string;
  returnDueMs: number | null;
  returnCommitmentMet?: boolean;
  borrowOverdue?: MemberCartBorrowOverdueSnapshot | null;
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

export function EmpruntBorrowSummarySection({
  cartId,
  returnDueMs,
  returnCommitmentMet,
  borrowOverdue = null,
}: EmpruntBorrowSummarySectionProps) {
  const hasDue = returnDueMs != null && Number.isFinite(returnDueMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const alertPhase = hasDue && isBorrowReturnAlertPhaseParis(now, returnDueMs);
  const dueDateLabel = hasDue ? formatBorrowReturnDueDateFr(returnDueMs) : "";

  const body = cn(
    segnaMontserrat.className,
    "text-center text-[16px] font-normal leading-snug sm:text-[17px] sm:leading-relaxed",
    BODY_GRAY,
  );

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
          src={alertPhase ? "/ressources/Alerte_oeil.png" : "/ressources/oeil_charme.png"}
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
        {alertPhase ? "Retourne ta box" : "Gère ton panier"}
      </h2>
      <div className="mt-3 max-w-[22rem] space-y-2">
        {returnCommitmentMet ? (
          <p className={body}>
            Retour enregistré au relais —{" "}
            <span className="font-bold text-black">engagement sur les délais respecté</span>.
          </p>
        ) : alertPhase ? (
          <p className={body}>
            Renvoie ta box le <span className="font-bold text-black">{dueDateLabel}</span> ou prolonge ton
            échange.
          </p>
        ) : hasDue ? (
          <p className={body}>
            À retourner avant le <span className="font-bold text-black">{dueDateLabel}</span>.
          </p>
        ) : (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_GRAY)}>
            La date de retour s&apos;affichera dès la livraison de ta commande.
          </p>
        )}
        {!alertPhase && !returnCommitmentMet ? (
          <p className={cn("text-[15px] font-normal leading-relaxed", BODY_GRAY)}>
            Prolonge ou renvoie ton panier quand tu veux.
          </p>
        ) : null}
      </div>
      <div className="mt-8 flex w-full max-w-md flex-row items-stretch justify-center gap-2 sm:gap-2.5">
        <Link href={`/commande/${cartId}/prolonger`} className={btnSecondary}>
          Prolonger l&apos;échange
        </Link>
        <Link href={`/exchange/retour/${cartId}`} className={btnPrimary}>
          Retourner
        </Link>
      </div>
      {borrowOverdue && !returnCommitmentMet ? (
        <EmpruntBorrowOverdueSection overdue={borrowOverdue} />
      ) : null}
    </section>
  );
}
