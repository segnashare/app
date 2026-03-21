import Link from "next/link";
import { Plus } from "lucide-react";
import { Playfair_Display } from "next/font/google";

import { ExchangeLendItemRow } from "@/components/exchange/ExchangeLendItemRow";
import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800"] });

export type LendItem = {
  id: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  currentValue: number | null;
  itemStatus: string;
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
};

export function ExchangeLendsSection({ lends, membershipLabel }: ExchangeLendsSectionProps) {
  const isGuest = membershipLabel === "Guest";
  const showGuestUpsell = isGuest && lends.length === 0;
  const emptyLendsSubtitle =
    membershipLabel === "Membre X"
      ? "Prête jusqu'à 10 items pour maximiser ta capacité d'emprunt !"
      : membershipLabel === "Membre +"
        ? "Prête jusqu'à 5 items pour maximiser ta capacité d'emprunt !"
        : "N'achète plus de crédits: prête et emprunte en illimité !";

  return (
    <SectionBlock
      title="Prêts"
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

        {lends.length > 0 ? (
          <div className="-mx-5 divide-y-[1px] divide-zinc-200">
            {lends.map((item) => (
              <div key={item.id} className="px-5 py-2">
                <ExchangeLendItemRow
                  id={item.id}
                  name={item.name}
                  description={item.description}
                  brand={item.brand}
                  currentValue={item.currentValue}
                  itemStatus={item.itemStatus}
                  photoUrl={item.photoUrl}
                  photoPosition={item.photoPosition}
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
