"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

export type ExchangeOrderCard = {
  id: string;
  /** Identifiant court affiché après « N° commande : ». */
  orderNumberCompact: string;
  /** État lisible (phase logistique, confirmée, archivée…). */
  statusLabel: string;
  /** Sous-texte livraison (en transit / livré) ; absent tant que l’expédition n’y est pas. */
  deliveryLabel: string | null;
  /** Première photo de chaque article du panier (ordre des lignes). */
  itemThumbUrls: string[];
  showPulse?: boolean;
  /** Après livraison aller : page emprunt au lieu de commande. */
  detailHref?: string;
};

type ExchangeInteractionsSectionProps = {
  ongoingOrders: ExchangeOrderCard[];
  recentOrders: ExchangeOrderCard[];
};

type ExchangeTab = "history" | "ongoing";

function OrderStatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-tight",
        active
          ? "border-amber-300/90 bg-amber-50 text-amber-950"
          : "border-zinc-200 bg-zinc-100 text-zinc-800",
      )}
    >
      {active ? (
        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function OrderCards({ orders }: { orders: ExchangeOrderCard[] }) {
  if (orders.length === 0) {
    return null;
  }
  return (
    <div className="-mx-5 divide-y-[1px] divide-zinc-200">
      {orders.map((order) => (
        <article key={order.id} className="px-5 py-2">
          <div className="min-w-0">
            <Link
              href={order.detailHref ?? `/commande/${order.id}`}
              className="group flex items-start justify-between gap-2 rounded-lg outline-none ring-zinc-400 focus-visible:ring-2"
            >
              <p className="min-w-0 text-[16px] font-bold leading-snug tracking-tight text-zinc-900">
                N° commande : {order.orderNumberCompact}
              </p>
              <ChevronRight
                className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300 transition group-hover:text-zinc-500"
                aria-hidden
              />
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <OrderStatusPill label={order.statusLabel} active={Boolean(order.showPulse)} />
              {order.deliveryLabel ? (
                <p className="min-w-0 text-[13px] font-medium leading-snug text-zinc-500">{order.deliveryLabel}</p>
              ) : null}
            </div>
          </div>
          {order.itemThumbUrls.length > 0 ? (
            <div className="mt-3">
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {order.itemThumbUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- URLs signées dynamiques, pas d’optimisation domaine fixe
                  <img
                    key={`${order.id}-thumb-${i}`}
                    src={url}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg border border-zinc-100 object-cover"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function ExchangeInteractionsSection({ ongoingOrders, recentOrders }: ExchangeInteractionsSectionProps) {
  const [activeTab, setActiveTab] = useState<ExchangeTab>("ongoing");

  return (
    <SectionBlock
      title="Échanges"
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("ongoing")}
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition",
              activeTab === "ongoing" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800",
            )}
          >
            En cours
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition",
              activeTab === "history" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800",
            )}
          >
            Historique
          </button>
        </div>

        <div className="space-y-3">
          {activeTab === "ongoing" ? (
            ongoingOrders.length > 0 ? (
              <OrderCards orders={ongoingOrders} />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500">
                Aucun échange en cours.
              </p>
            )
          ) : recentOrders.length > 0 ? (
            <OrderCards orders={recentOrders} />
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500">
              Aucun échange dans l&apos;historique.
            </p>
          )}
        </div>
      </CardBase>
    </SectionBlock>
  );
}
