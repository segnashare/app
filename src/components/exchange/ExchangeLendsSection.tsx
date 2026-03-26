import Link from "next/link";
import { Plus } from "lucide-react";
import { Playfair_Display } from "next/font/google";

import { ExchangeLendItemRow } from "@/components/exchange/ExchangeLendItemRow";
import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800"] });

/** Aligné sur le tri de `exchange/page.tsx` (mêmes rangs que `lendPipelineRank`). */
function lendPipelineRankForSection(l: LendItem): number {
  const ls = l.intake?.listing_stage?.toLowerCase() ?? "";
  const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
  if (ls === "validated") {
    if (fs === "verified") return 0;
    if (fs === "in_verification") return 1;
    if (fs === "shipping" || fs === "") return 2;
  }
  if (ls === "validation_pending") return 3;
  if (ls === "evaluated") return 4;
  if (ls === "evaluation") return 5;
  return 6;
}

export type LendItem = {
  id: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  currentValue: number | null;
  itemStatus: string;
  intake?: {
    listing_stage: string;
    fulfillment_stage: string | null;
    /** Pour liens bordereau : fusion MR (`mr_merge_item_ids`) si expédition groupée. */
    metadata?: unknown;
  } | null;
  photoUrl?: string | null;
  photoPosition?: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
};

type ExchangeLendsSectionProps = {
  lends: LendItem[];
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  /** Plafond prêts (depuis user_monthly_entitlements / fallback produit). 0 = pas d’affichage compteur. */
  includedLendsLimit: number;
  /** Pièces déjà validées (intake annonce `validated`) — seules comptées pour n / max. */
  validatedLendsCount: number;
  /** Pièces en expédition membre — si 2–5, proposition d’envoi groupé. */
  mergedShippingCandidateIds: string[];
};

export function ExchangeLendsSection({
  lends,
  membershipLabel,
  includedLendsLimit,
  validatedLendsCount,
  mergedShippingCandidateIds,
}: ExchangeLendsSectionProps) {
  const isGuest = membershipLabel === "Guest";
  const showGuestUpsell = isGuest && lends.length === 0;
  const emptyLendsSubtitle =
    membershipLabel === "Membre X"
      ? "Prête jusqu'à 10 items pour maximiser ta capacité d'emprunt !"
      : membershipLabel === "Membre +"
        ? "Prête jusqu'à 5 items pour maximiser ta capacité d'emprunt !"
        : "N'achète plus de crédits: prête et emprunte en illimité !";

  const lendsTitle =
    !isGuest && includedLendsLimit > 0
      ? `Prêts (${validatedLendsCount}/${includedLendsLimit})`
      : "Prêts";

  const balanceUnitLabel = membershipLabel === "Guest" ? "pods" : "mods";

  const verifiedLendingCreditPoints = lends.reduce((sum, l) => {
    const ls = l.intake?.listing_stage?.toLowerCase() ?? "";
    const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
    if (ls !== "validated" || fs !== "verified") return sum;
    const pts = l.currentValue;
    if (pts == null || !Number.isFinite(pts) || pts <= 0) return sum;
    return sum + Math.floor(pts);
  }, 0);

  const showMergePopup =
    mergedShippingCandidateIds.length >= 2 && mergedShippingCandidateIds.length <= 5;
  const mergeHref = `/items/shipping?ids=${mergedShippingCandidateIds.map(encodeURIComponent).join(",")}`;

  const lendsPreShipping: LendItem[] = [];
  const lendsShippingOnly: LendItem[] = [];
  const lendsAfterShipping: LendItem[] = [];
  for (const item of lends) {
    const r = lendPipelineRankForSection(item);
    if (r <= 1) lendsPreShipping.push(item);
    else if (r === 2) lendsShippingOnly.push(item);
    else lendsAfterShipping.push(item);
  }

  const titleEnd =
    lends.length > 0 ? (
      <div className="max-w-[min(100%,11rem)] text-right">
        <p className="text-[13px] font-semibold leading-tight tracking-tight text-zinc-900 tabular-nums">
          +{verifiedLendingCreditPoints.toLocaleString("fr-FR")} {balanceUnitLabel}
        </p>
        <p className="mt-0.5 text-[10px] font-medium leading-tight text-zinc-500">Prêts vérifiés</p>
      </div>
    ) : null;

  return (
    <SectionBlock
      title={lendsTitle}
      titleEnd={titleEnd}
      description={lends.length === 0 ? emptyLendsSubtitle : undefined}
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(playfairDisplay.className, "text-[30px] font-bold leading-none")}
      descriptionClassName="font-medium text-[20px] leading-none tracking-normal text-[#424242]"
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        {!showGuestUpsell && lends.length === 0 ? (
          <div className="rounded-xl bg-white px-3 py-4">
            <p className="text-center text-sm font-semibold text-zinc-700">Pas de prêts</p>
          </div>
        ) : null}

        {lendsPreShipping.length + lendsShippingOnly.length > 0 ? (
          <div className="-mx-5 divide-y-[1px] divide-zinc-200">
            {lendsPreShipping.map((item) => (
              <div key={item.id} className="px-5 py-2">
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  pointsUnitLabel={balanceUnitLabel}
                />
              </div>
            ))}
            {lendsShippingOnly.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "px-5 py-2",
                  showMergePopup && mergedShippingCandidateIds.includes(item.id)
                    ? "border-b-0 bg-sky-50/55 ring-1 ring-sky-400/80 ring-inset"
                    : "",
                )}
              >
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  pointsUnitLabel={balanceUnitLabel}
                />
              </div>
            ))}
          </div>
        ) : null}

        {showMergePopup ? (
          <div
            className="rounded-2xl border border-sky-400 bg-sky-100/65 p-4 shadow-[0_8px_30px_rgba(56,189,248,0.12)] backdrop-blur-[2px]"
            role="dialog"
            aria-label="Proposition d'expédition groupée"
          >
            <p className="text-[15px] font-semibold text-sky-950">
              {mergedShippingCandidateIds.length} pièces à expédier
            </p>
            <p className="mt-1.5 text-sm leading-snug text-sky-900/90">
              Tu peux préparer <strong>un envoi regroupé</strong> (même colis vers Segna). Ouvre la page transverse pour
              la liste et le bordereau.
            </p>
            <Link
              href={mergeHref}
              className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-sky-700 px-4 py-2.5 text-sm font-bold text-white"
            >
              Expédition fusionnée
            </Link>
          </div>
        ) : null}

        {lendsAfterShipping.length > 0 ? (
          <div className="-mx-5 divide-y-[1px] divide-zinc-200">
            {lendsAfterShipping.map((item) => (
              <div key={item.id} className="px-5 py-2">
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  intake={item.intake}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
                  pointsUnitLabel={balanceUnitLabel}
                />
              </div>
            ))}
          </div>
        ) : null}

        {showGuestUpsell ? (
          <Link href="/package" className="inline-flex w-full items-center justify-between gap-3 rounded-2xl border border-[#EEDDBB] bg-[#FFEFC9] px-4 py-3 text-left">
            <span className="inline-flex min-w-0 items-center gap-3">
              <span className="text-[18px] font-bold leading-[1.05] text-[#000000]">
                -30% avec Segna+ en choisissant l'abonn...
              </span>
            </span>
            <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-gradient-to-r from-[#FAE1B7] to-[#EAB25A] px-4 font-semibold text-[#000000]">
              Changer
            </span>
          </Link>
        ) : (
          <div className="flex justify-end rounded-xl py-0.5">
            <Link
              href="/items/new?fresh=1"
              className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Prêter une pièce
            </Link>
          </div>
        )}
      </CardBase>
    </SectionBlock>
  );
}
