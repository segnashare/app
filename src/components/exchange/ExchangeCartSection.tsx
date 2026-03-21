"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Playfair_Display } from "next/font/google";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { cn } from "@/lib/utils/cn";

export type CartLineStatus = "disponible" | "reserve" | "echec";

export type CartLine = {
  id: string;
  itemId: string | null;
  itemName: string;
  pricePoints: number;
  status: CartLineStatus;
};

const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800"] });

const STATUS_CLASSNAMES: Record<CartLineStatus, string> = {
  disponible: "bg-emerald-100 text-emerald-700",
  reserve: "bg-amber-100 text-amber-700",
  echec: "bg-red-100 text-red-700",
};

type ExchangeCartSectionProps = {
  initialLines: CartLine[];
  cartStatusLabel: string;
  membershipLabel: "Guest" | "Membre +" | "Membre X";
};

export function ExchangeCartSection({ initialLines, cartStatusLabel, membershipLabel }: ExchangeCartSectionProps) {
  const [lines, setLines] = useState<CartLine[]>(initialLines);
  const totalPoints = useMemo(() => lines.reduce((sum, line) => sum + line.pricePoints, 0), [lines]);
  const emptyCartSubtitle =
    membershipLabel === "Membre X"
      ? "Emprunte jusqu'à 10 items"
      : membershipLabel === "Membre +"
        ? "Emprunte jusqu'à 5 items"
        : "Loue jusqu'à 5 items";

  return (
    <SectionBlock
      title="Panier"
      description={lines.length === 0 ? emptyCartSubtitle : undefined}
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(playfairDisplay.className, "text-[28px] font-bold leading-none")}
      descriptionClassName="font-medium text-[20px] leading-none tracking-normal text-[#424242]"
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        {lines.length > 0 ? (
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
            <span className="text-sm font-medium text-zinc-700">Statut panier</span>
            <span className="rounded-full bg-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-700">{cartStatusLabel}</span>
          </div>
        ) : null}

        {lines.length === 0 ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-white px-3 py-4">
              <p className="text-center text-sm font-semibold text-zinc-700">Panier vide</p>
            </div>

            <div className="flex justify-end rounded-xl py-0.5">
              <Link
                href="/shop"
                className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                <span>Ajouter des articles</span>
              </Link>
            </div>
          </div>
        ) : null}

        {lines.map((line) => (
          <article key={line.id} className="rounded-xl border border-zinc-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={line.itemId ? `/items/${line.itemId}` : "/shop"} className="block truncate text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline">
                  {line.itemName}
                </Link>
                <p className="mt-1 text-sm text-zinc-600">{line.pricePoints} points</p>
              </div>
              <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", STATUS_CLASSNAMES[line.status])}>{line.status}</span>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="text-xs font-semibold text-zinc-500 underline underline-offset-2"
                onClick={() => setLines((previous) => previous.filter((entry) => entry.id !== line.id))}
              >
                Retirer
              </button>
            </div>
          </article>
        ))}

        {lines.length > 0 ? (
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
            <span className="text-sm font-medium text-zinc-700">Total panier actif</span>
            <span className="text-sm font-semibold text-zinc-900">{totalPoints} points</span>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <Link href="/items/new?fresh=1" className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-800">
              Ajouter une piece
            </Link>
            <button type="button" className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-950 text-sm font-semibold text-white">
              Reserver
            </button>
          </div>
        ) : null}
      </CardBase>
    </SectionBlock>
  );
}
