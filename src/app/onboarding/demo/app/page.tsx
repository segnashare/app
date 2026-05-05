"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { OnboardingDemoState } from "@/lib/onboarding/demo-state";

export default function OnboardingDemoAppPage() {
  const [state, setState] = useState<OnboardingDemoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const response = await fetch("/api/onboarding/demo-state", { method: "GET" });
        if (!response.ok) {
          throw new Error("Impossible de charger la démo");
        }
        const payload = (await response.json()) as { demoState?: OnboardingDemoState };
        if (isMounted) {
          setState(payload.demoState ?? null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Erreur inattendue");
        }
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  const cartItemCount = useMemo(
    () => state?.cart.lines.reduce((sum, line) => sum + line.qty, 0) ?? 0,
    [state],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-zinc-50 px-4 py-6 md:px-6">
      <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Mode de demo actif: tu explores l'app sur des donnees fictives (aucune action ici ne modifie le reel).
      </div>

      {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {!state ? (
        <p className="text-sm text-zinc-600">Chargement de la demo...</p>
      ) : (
        <>
          <section className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4">
            <h1 className="text-xl font-semibold text-zinc-900">Pieces pre-remplies</h1>
            <ul className="mt-3 space-y-2">
              {state.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2">
                  <span className="text-sm font-medium text-zinc-900">{item.title}</span>
                  <span className="text-xs text-zinc-600">{item.status}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-6 grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="text-base font-semibold text-zinc-900">Panier fictif</h2>
              <p className="mt-2 text-sm text-zinc-700">{cartItemCount} article(s) dans le panier</p>
              <p className="text-xs text-zinc-500">Statut: {state.cart.status}</p>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="text-base font-semibold text-zinc-900">Commande fictive</h2>
              <p className="mt-2 text-sm text-zinc-700">#{state.orders[0]?.id ?? "demo-order"}</p>
              <p className="text-xs text-zinc-500">
                Statut: {state.orders[0]?.state ?? "confirmed"} - {state.orders[0]?.total ?? 0} credits
              </p>
            </article>
          </section>

          <div className="flex flex-wrap gap-3">
            <Link href="/onboarding/bridge" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
              Continuer vers la sortie onboarding
            </Link>
            <Link href="/onboarding/demo" className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700">
              Retour ecran demo
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
