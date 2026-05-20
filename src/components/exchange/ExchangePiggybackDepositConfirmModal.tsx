"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { MemberPiggybackDepositPrompt } from "@/lib/items/intake-cart-return-piggyback";
import { cn } from "@/lib/utils/cn";

type Props = {
  initialQueue: MemberPiggybackDepositPrompt[];
};

/**
 * Modale Échange (bloquante) : la membre confirme Oui / Non que la pièce est dans la pochette retour déposée.
 */
export function ExchangePiggybackDepositConfirmModal({ initialQueue }: Props) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [itemIndex, setItemIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = queue[0] ?? null;
  const currentItem = active?.items[itemIndex] ?? null;

  useEffect(() => {
    setQueue(initialQueue);
    setItemIndex(0);
    setError(null);
  }, [initialQueue]);

  useEffect(() => {
    if (!active) return;
    if (itemIndex >= active.items.length) {
      setItemIndex(0);
    }
  }, [active, itemIndex]);

  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/items/shipping/piggyback-deposit-pending", {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        queue?: MemberPiggybackDepositPrompt[];
      };
      if (res.ok && data.ok && Array.isArray(data.queue)) {
        setQueue(data.queue);
        setItemIndex(0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function answer(inBox: boolean) {
    if (!active || !currentItem || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/items/shipping/piggyback-deposit-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          return_shipment_id: active.return_shipment_id,
          decisions: [{ item_id: currentItem.item_id, in_box: inBox }],
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        return;
      }

      const nextIndex = itemIndex + 1;
      if (nextIndex < active.items.length) {
        setItemIndex(nextIndex);
        return;
      }

      await refreshQueue();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  if (!active || !currentItem) return null;

  const itemLabel = currentItem.title?.trim() || "ta pièce";
  const progressHint =
    active.items.length > 1 ? ` (${itemIndex + 1}/${active.items.length})` : "";

  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center bg-black/45 p-5"
      role="dialog"
      aria-labelledby="piggyback-deposit-title"
      aria-modal="true"
    >
      <div className={cn(SEGNA_DIALOG_CARD_CLASS, "w-full max-w-[340px] text-center")}>
            <h2 id="piggyback-deposit-title" className={segnaDialogTitleClass()}>
              Pièce dans ton retour ?{progressHint}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-3")}>
              Tu avais indiqué glisser{" "}
              <span className="font-semibold text-zinc-800">{itemLabel}</span> dans la pochette du retour{" "}
              <span className="font-mono text-zinc-800">{active.order_number_compact}</span>. C&apos;est bien le cas ?
            </p>
            {error ? <p className="mt-3 text-sm font-medium text-zinc-800">{error}</p> : null}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answer(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Oui
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answer(false)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-sm font-semibold text-zinc-900 disabled:opacity-50"
              >
                Non
              </button>
            </div>
          </div>
    </div>
  );
}
