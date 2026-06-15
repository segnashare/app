"use client";

import { Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { MemberIntakeTransferDepositPrompt } from "@/lib/items/member-intake-transfer-deposit-confirm";
import { cn } from "@/lib/utils/cn";

type Props = {
  initialQueue?: MemberIntakeTransferDepositPrompt[];
};

/**
 * Modale membre (bloquante) : confirmer le contenu réel du colis déposé au relais.
 */
export function MemberIntakeTransferDepositConfirmModal({ initialQueue }: Props) {
  const router = useRouter();
  const [queue, setQueue] = useState<MemberIntakeTransferDepositPrompt[]>(initialQueue ?? []);
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(Boolean(initialQueue?.length));

  const active = queue[0] ?? null;

  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/items/shipping/transfer-deposit-pending", {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        queue?: MemberIntakeTransferDepositPrompt[];
      };
      if (res.ok && data.ok && Array.isArray(data.queue)) {
        setQueue(data.queue);
      }
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!initialQueue?.length) {
      void refreshQueue();
    } else {
      setLoaded(true);
    }
  }, [initialQueue, refreshQueue]);

  useEffect(() => {
    if (!active) return;
    const initial: Record<string, boolean> = {};
    for (const it of active.items) {
      initial[it.item_id] = true;
    }
    setPresent(initial);
    setError(null);
  }, [active?.shipment_id, active?.items]);

  const presentItemIds = useMemo(
    () => (active?.items ?? []).filter((it) => present[it.item_id]).map((it) => it.item_id),
    [active?.items, present],
  );

  const hasAtLeastOne = presentItemIds.length > 0;

  async function handleSubmit() {
    if (!active || !hasAtLeastOne || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/items/shipping/transfer-deposit-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          shipment_id: active.shipment_id,
          present_item_ids: presentItemIds,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
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

  if (!loaded || !active) return null;

  return (
    <div
      className="fixed inset-0 z-[46] flex items-center justify-center bg-black/45 p-5"
      role="dialog"
      aria-labelledby="transfer-deposit-title"
      aria-modal="true"
    >
      <div className={cn(SEGNA_DIALOG_CARD_CLASS, "w-full max-w-[340px]")}>
        <div className="flex items-start gap-2">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-zinc-900" aria-hidden />
          <h2 id="transfer-deposit-title" className={segnaDialogTitleClass()}>
            Contenu de ton colis
          </h2>
        </div>

        <p className={cn(segnaDialogBodyClass(), "mt-3")}>
          Lesquelles de ces pièces sont dans le colis déposé au relais ? Décoche celles qui manquent.
        </p>

        <ul className="mt-4 space-y-2">
          {active.items.map((it) => {
            const checked = Boolean(present[it.item_id]);
            return (
              <li
                key={it.item_id}
                className={cn(
                  "rounded-xl border px-3 py-2.5 transition",
                  checked ? "border-zinc-200 bg-white" : "border-zinc-300 bg-zinc-50",
                )}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 appearance-none rounded border-2 border-zinc-900 bg-white checked:border-zinc-900 checked:bg-zinc-900 checked:bg-[length:10px] checked:bg-center checked:bg-no-repeat checked:bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2012%2012%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M2%206l3%203%205-5%22%20stroke%3D%22white%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-1 disabled:opacity-50"
                    checked={checked}
                    disabled={submitting}
                    onChange={(e) =>
                      setPresent((prev) => ({
                        ...prev,
                        [it.item_id]: e.target.checked,
                      }))
                    }
                  />
                  <span className="min-w-0 flex-1 text-[14px] font-semibold text-zinc-900">
                    {it.title ?? "Pièce"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {error ? <p className="mt-3 text-sm font-medium text-zinc-800">{error}</p> : null}

        <button
          type="button"
          disabled={!hasAtLeastOne || submitting}
          onClick={() => void handleSubmit()}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-zinc-900 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Confirmer mon colis
        </button>
      </div>
    </div>
  );
}
