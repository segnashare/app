import type { MemberCartBorrowOverdueSnapshot } from "@/lib/cart/fetch-member-cart-borrow-overdue";
import {
  formatBorrowOverdueEmpruntCompactBodyLinesFr,
  formatBorrowOverdueEmpruntCompactTitleFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type EmpruntBorrowOverdueSectionProps = {
  overdue: MemberCartBorrowOverdueSnapshot;
};

/** Rappel retard compact sous les CTA (fiche emprunt). */
export function EmpruntBorrowOverdueSection({ overdue }: EmpruntBorrowOverdueSectionProps) {
  const [introLine, totalLine] = formatBorrowOverdueEmpruntCompactBodyLinesFr(overdue.totalPenaltyCents);

  return (
    <div
      className={cn(segnaMontserrat.className, "mt-4 max-w-[22rem] text-center")}
      aria-live="polite"
    >
      <p className="text-[15px] font-semibold text-zinc-900">{formatBorrowOverdueEmpruntCompactTitleFr()}</p>
      <p className="mt-1 text-[14px] leading-snug text-zinc-600">
        {introLine}
        <br />
        {totalLine}
      </p>
    </div>
  );
}
