import Link from "next/link";

import type { MemberCartBorrowOverdueSnapshot } from "@/lib/cart/fetch-member-cart-borrow-overdue";
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

/**
 * Récap pénalités de retard sous le bloc emprunt (jours passés + alerte prélèvement carte).
 */
export function EmpruntBorrowOverdueSection({ overdue }: EmpruntBorrowOverdueSectionProps) {
  const dayCount = overdue.latestLateDayIndex;
  const dayLabel = dayCount === 1 ? "1 jour" : `${dayCount} jours`;

  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "mx-5 mb-2 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-4",
      )}
      aria-labelledby="emprunt-overdue-title"
    >
      <h3 id="emprunt-overdue-title" className="text-[16px] font-bold leading-snug text-red-900">
        Retard de retour : {dayLabel}
        {overdue.status === "escalated" ? " (dossier transmis)" : ""}
      </h3>
      <p className="mt-2 text-[14px] leading-relaxed text-red-900/90">
        Des pénalités de retard s&apos;appliquent tant que ta box n&apos;est pas renvoyée
        {overdue.totalPenaltyCents > 0 ? (
          <>
            {" "}
            (montant cumulé : <strong>{formatEuros(overdue.totalPenaltyCents)}</strong>)
          </>
        ) : null}
        . Consulte les{" "}
        <Link href={CG_LOCATION_HREF} className={cn(segnaInlineActionLinkClass, "text-red-900")}>
          conditions générales de location
        </Link>{" "}
        pour le détail.
      </p>
      {overdue.hasFailedCharge ? (
        <p className="mt-2 text-[14px] font-semibold leading-relaxed text-red-950">
          Un ou plusieurs prélèvements sur ta carte n&apos;ont pas abouti.{" "}
          <Link href="/profile?tab=plus" className="underline decoration-red-800/50">
            Mets à jour ton moyen de paiement
          </Link>{" "}
          pour régulariser.
        </p>
      ) : null}
      {overdue.latestLateDayIndex >= 14 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-red-900/90">
          Au-delà de 14 jours, ton dossier peut être escaladé. Contacte le support si besoin.
        </p>
      ) : null}
    </section>
  );
}
