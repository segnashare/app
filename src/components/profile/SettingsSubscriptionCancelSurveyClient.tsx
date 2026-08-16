"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Gift, Receipt, Coins, X } from "lucide-react";
import { useState } from "react";

import {
  SUBSCRIPTION_CANCEL_REASONS,
  type SubscriptionCancelReasonCode,
} from "@/lib/subscription/cancel-reasons";
import { markSubscriptionCancelPending } from "@/lib/subscription/subscription-cancel-storage";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  returnPath: string;
  managePath: string;
};

const ICONS = {
  clock: Clock,
  gift: Gift,
  receipt: Receipt,
  alert: AlertTriangle,
  coins: Coins,
} as const;

export function SettingsSubscriptionCancelSurveyClient({ returnPath, managePath }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SubscriptionCancelReasonCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueCancel = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode: selected }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        period_end?: string | null;
        error?: string;
      } | null;
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Impossible d’annuler l’abonnement.");
      }
      markSubscriptionCancelPending(payload.period_end ?? null);
      router.replace("/exchange?subscription=canceled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      setBusy(false);
    }
  };

  return (
    <main className={cn(segnaMontserrat.className, "flex min-h-[100dvh] flex-col bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between px-5 pb-2 pt-7">
        <Link
          href={managePath}
          aria-label="Fermer"
          className="-ml-1.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-900"
        >
          <X className="h-7 w-7" strokeWidth={2} />
        </Link>
        <span className="inline-block h-10 w-10" aria-hidden />
      </header>

      <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-5 pb-8">
        <h1 className="text-balance text-[26px] font-bold leading-tight tracking-tight text-zinc-900">
          Pourquoi souhaites-tu mettre fin à ton abonnement&nbsp;?
        </h1>
        <p className="mt-3 text-[14px] leading-snug text-zinc-500">
          Nous utiliserons ta réponse pour améliorer Segna.
        </p>

        <div className="mt-6 divide-y divide-zinc-100 border-t border-zinc-100">
          {SUBSCRIPTION_CANCEL_REASONS.map((reason) => {
            const Icon = ICONS[reason.icon];
            const checked = selected === reason.code;
            return (
              <button
                key={reason.code}
                type="button"
                onClick={() => setSelected(reason.code)}
                className="flex w-full items-center gap-3 py-4 text-left transition hover:bg-zinc-50"
              >
                <Icon className="h-5 w-5 shrink-0 text-zinc-700" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-zinc-900">
                  {reason.label}
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    checked ? "border-zinc-900 bg-zinc-900" : "border-zinc-300 bg-white",
                  )}
                  aria-hidden
                >
                  {checked ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {error ? <p className="mt-4 text-[13px] text-red-600">{error}</p> : null}

        <div className="mt-auto flex flex-col gap-2.5 pt-8">
          <button
            type="button"
            disabled={!selected || busy}
            onClick={() => void continueCancel()}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-zinc-200 px-4 text-[16px] font-semibold text-zinc-900 transition enabled:bg-zinc-900 enabled:text-white enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Annulation…" : "Continuer pour annuler"}
          </button>
          <Link
            href={returnPath}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-zinc-100 px-4 text-[16px] font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            Conserver mon abonnement
          </Link>
        </div>
      </section>
    </main>
  );
}
