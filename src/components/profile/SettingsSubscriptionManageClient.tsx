"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { formatLongDateParis } from "@/lib/datetime/segna-datetime";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  returnPath: string;
  packageHref: string;
  cancelSurveyHref: string;
  planBadge: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function SettingsSubscriptionManageClient({
  returnPath,
  packageHref,
  cancelSurveyHref,
  planBadge,
  periodEnd,
  cancelAtPeriodEnd,
}: Props) {
  return (
    <main className={cn(segnaMontserrat.className, "min-h-[100dvh] bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <Link
          href={returnPath}
          aria-label="Retour"
          className="-ml-1.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-900"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} />
        </Link>
        <h1 className="text-center text-[20px] font-bold leading-tight text-zinc-900">Mon abonnement</h1>
        <span className="inline-block h-10 w-10" aria-hidden />
      </header>

      <section className="mx-auto w-full max-w-[460px] pb-10 pt-5">
        <div className="px-5 pb-5">
          <p className="text-[16px] font-semibold text-zinc-900">
            {planBadge ? `Offre ${planBadge}` : "Abonnement Segna"}
          </p>
          {cancelAtPeriodEnd && periodEnd ? (
            <p className="mt-2 text-[13px] leading-snug text-amber-800">
              Résiliation programmée — tu restes membre jusqu’au {formatLongDateParis(periodEnd)}.
            </p>
          ) : periodEnd ? (
            <p className="mt-2 text-[13px] leading-snug text-zinc-500">
              Prochain renouvellement le {formatLongDateParis(periodEnd)}.
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          <Link
            href={packageHref}
            className="flex min-h-[52px] items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-medium text-zinc-900">Changer d’offre</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">Voir les formules Segna.</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden />
          </Link>

          {cancelAtPeriodEnd ? (
            <div className="px-5 py-4">
              <p className="text-[16px] font-medium text-zinc-400">Renoncer à l’abonnement</p>
              <p className="mt-0.5 text-[13px] text-zinc-400">Déjà programmé pour la fin de période.</p>
            </div>
          ) : (
            <Link
              href={cancelSurveyHref}
              className="flex min-h-[52px] items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-medium text-zinc-900">Renoncer à l’abonnement</p>
                <p className="mt-0.5 text-[13px] text-zinc-500">Annuler le renouvellement automatique.</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden />
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
