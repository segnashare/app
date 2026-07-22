"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { memberOrderTypeLabel, type MemberOrderKind } from "@/lib/cart/member-order-kind";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

export type ExchangeOrderCard = {
  id: string;
  /** Location (emprunt / retour) ou achat définitif. */
  orderKind: MemberOrderKind;
  /** « Location 7j », « Location 30j », « Achat ». */
  orderTypeLabel: string;
  /** Identifiant court affiché dans « Commande XXX ». */
  orderNumberCompact: string;
  /** État lisible (phase logistique, confirmée, archivée…). */
  statusLabel: string;
  /** Pastille rouge (retour urgent / retard). Les autres états restent neutres. */
  statusPillTone?: "success" | "return";
  /** Sous-texte livraison (en transit / livré) ; absent tant que l’expédition n’y est pas. */
  deliveryLabel: string | null;
  /** Première photo de chaque article du panier (ordre des lignes). */
  itemThumbUrls: string[];
  showPulse?: boolean;
  /** Pastille + vignettes : frémissement (J-J ou retard), comme poubelle / wallet panier. */
  showReturnVibrate?: boolean;
  /** Cible du tap : commande, emprunt (livré sans retour actif), ou suivi retour. */
  detailHref?: string;
};

type ExchangeInteractionsSectionProps = {
  ongoingOrders: ExchangeOrderCard[];
  recentOrders: ExchangeOrderCard[];
};

type ExchangeStatusTab = "history" | "ongoing";

function emptyOrdersMessage(statusTab: ExchangeStatusTab): string {
  return statusTab === "ongoing" ? "Aucune commande en cours." : "Aucune commande dans l'historique.";
}

function StatusTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition",
        active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800",
      )}
    >
      {label}
    </button>
  );
}

function OrderStatusPill({
  label,
  active,
  tone,
  vibrate,
}: {
  label: string;
  active: boolean;
  tone?: "success" | "return";
  vibrate?: boolean;
}) {
  const isUrgent = tone === "return" || label === "En retard";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-tight",
        vibrate && "exchange-return-urgent-vibrate",
        isUrgent
          ? "segna-urgent-red-shimmer-active segna-urgent-red-shimmer-target border-red-600 bg-red-600 text-white"
          : "border-zinc-300 bg-white text-zinc-800",
      )}
    >
      {active && !isUrgent ? (
        <span
          className="exchange-order-status-dot-pulse inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500"
          aria-hidden
        />
      ) : null}
      {active && isUrgent ? (
        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-white" aria-hidden />
      ) : null}
      <span className="relative z-[2] truncate">{label}</span>
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
              <div className="min-w-0">
                <p className="text-[16px] font-bold leading-snug tracking-tight text-zinc-900">
                  Commande {order.orderNumberCompact}
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-zinc-500">{order.orderTypeLabel}</p>
              </div>
              <ChevronRight
                className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300 transition group-hover:text-zinc-500"
                aria-hidden
              />
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <OrderStatusPill
                label={order.statusLabel}
                active={Boolean(order.showPulse)}
                tone={order.statusPillTone}
                vibrate={order.showReturnVibrate}
              />
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
                    className={cn(
                      "h-14 w-14 shrink-0 rounded-lg border border-zinc-100 object-cover",
                      order.showReturnVibrate && "exchange-return-urgent-vibrate",
                    )}
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
  const [statusTab, setStatusTab] = useState<ExchangeStatusTab>("ongoing");
  const orders = statusTab === "ongoing" ? ongoingOrders : recentOrders;

  return (
    <SectionBlock
      title="Commandes"
      className="w-full bg-white px-5 py-4"
      titleClassName={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}
    >
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <StatusTabButton active={statusTab === "ongoing"} label="En cours" onClick={() => setStatusTab("ongoing")} />
          <StatusTabButton active={statusTab === "history"} label="Historique" onClick={() => setStatusTab("history")} />
        </div>

        <div className="space-y-3">
          {orders.length > 0 ? (
            <OrderCards orders={orders} />
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500">
              {emptyOrdersMessage(statusTab)}
            </p>
          )}
        </div>
      </CardBase>
    </SectionBlock>
  );
}
