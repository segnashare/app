import Link from "next/link";

import { ChevronRight } from "lucide-react";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";

type HistoryOrder = {
  id: string;
  status: string;
  updatedAt: string;
};

type ExchangeHistorySectionProps = {
  totalOrders: number;
  recentOrders: HistoryOrder[];
};

export function ExchangeHistorySection({ totalOrders, recentOrders }: ExchangeHistorySectionProps) {
  return (
    <SectionBlock title="Tes échanges">
      <CardBase className="space-y-3">
        <div className="rounded-xl bg-zinc-50 px-3 py-2">
          <p className="text-sm font-medium text-zinc-700">Commandes passees: {totalOrders}</p>
        </div>

        {recentOrders.length > 0 ? (
          <div className="space-y-2">
            {recentOrders.map((order) => (
              <article key={order.id} className="rounded-xl border border-zinc-200 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-zinc-500">{order.id.slice(0, 8)}</p>
                <p className="mt-1 text-sm font-medium text-zinc-800">Statut: {order.status}</p>
                <p className="mt-1 text-xs text-zinc-500">Maj: {order.updatedAt}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">Pas encore de commande terminee dans l&apos;historique.</p>
        )}

        <Link
          href="/profile"
          className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-3 transition hover:bg-zinc-50"
        >
          <div>
            <p className="text-sm font-semibold text-zinc-900">Voir l&apos;historique complet</p>
            <p className="mt-1 text-sm text-zinc-600">Commandes passees, livraisons, retours et litiges.</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
        </Link>
      </CardBase>
    </SectionBlock>
  );
}
