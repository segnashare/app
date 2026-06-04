import Link from "next/link";

import type { MemberCartBorrowOverdueSnapshot } from "@/lib/cart/fetch-member-cart-borrow-overdue";
import {
  formatBorrowOverdueEmpruntBodyLinesFr,
  formatBorrowOverdueEscalationHintLinesFr,
  formatBorrowOverdueFailedChargeLinesFr,
  formatBorrowOverdueHeadlineLinesFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import { segnaInlineActionLinkClass } from "@/lib/ui/segna-inline-link";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const CG_LOCATION_HREF = "/legal/conditions-generales-location";

type EmpruntBorrowOverdueSectionProps = {
  overdue: MemberCartBorrowOverdueSnapshot;
};

function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

const bodyLineClass = "text-[14px] leading-relaxed text-red-900/90";

/**
 * Récap pénalités de retard sous le bloc emprunt (jours passés + alerte prélèvement carte).
 */
export function EmpruntBorrowOverdueSection({ overdue }: EmpruntBorrowOverdueSectionProps) {
  const lateDayIndex = overdue.latestLateDayIndex;
  const headlineLines = formatBorrowOverdueHeadlineLinesFr(lateDayIndex, {
    escalated: overdue.status === "escalated",
  });
  const bodyLines = formatBorrowOverdueEmpruntBodyLinesFr(lateDayIndex);
  const escalationLines = formatBorrowOverdueEscalationHintLinesFr(lateDayIndex);
  const failedChargeLines = overdue.hasFailedCharge ? formatBorrowOverdueFailedChargeLinesFr() : null;

  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "mx-5 mb-2 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-4",
      )}
      aria-labelledby="emprunt-overdue-title"
    >
      <h3 id="emprunt-overdue-title" className="text-[16px] font-bold leading-snug text-red-900">
        {headlineLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h3>
      <div className="mt-2 space-y-2">
        {bodyLines.map((line, i) => (
          <p key={i} className={bodyLineClass}>
            {line}
          </p>
        ))}
        {overdue.totalPenaltyCents > 0 ? (
          <p className={bodyLineClass}>
            Total à ce jour : <strong>{formatEuros(overdue.totalPenaltyCents)}</strong>
          </p>
        ) : null}
        <p className={bodyLineClass}>
          Détail dans les{" "}
          <Link href={CG_LOCATION_HREF} className={cn(segnaInlineActionLinkClass, "text-red-900")}>
            conditions générales de location
          </Link>
          .
        </p>
      </div>
      {failedChargeLines ? (
        <div className="mt-2 space-y-2">
          {failedChargeLines.map((line) => (
            <p key={line} className="text-[14px] font-semibold leading-relaxed text-red-950">
              {line}
            </p>
          ))}
          <p className="text-[14px] font-semibold leading-relaxed text-red-950">
            <Link href="/profile?tab=plus" className="underline decoration-red-800/50">
              Mettre à jour mon moyen de paiement
            </Link>
            .
          </p>
        </div>
      ) : null}
      {escalationLines ? (
        <div className="mt-2 space-y-2">
          {escalationLines.map((line) => (
            <p key={line} className={bodyLineClass}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
