"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  cartId: string;
  checkoutStatus?: string | null;
  checkoutReason?: string | null;
};

export function BorrowOverdueRegulariserClient({ cartId, checkoutStatus, checkoutReason }: Props) {
  const [message, setMessage] = useState("Redirection vers Stripe…");
  const [error, setError] = useState<string | null>(null);
  const [profileOnly, setProfileOnly] = useState(false);

  useEffect(() => {
    if (checkoutStatus === "success") {
      setMessage("Paiement enregistré. Ta carte est enregistrée pour les prochains prélèvements.");
      return;
    }
    if (checkoutStatus === "cancelled") {
      setError("Paiement annulé. Tu peux réessayer quand tu veux.");
      return;
    }
    if (checkoutStatus === "error") {
      setError("Le paiement n'a pas abouti. Réessaie ou mets à jour ta carte.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stripe/borrow-overdue/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartId }),
        });
        const data = (await res.json()) as { url?: string; message?: string; code?: string };
        if (cancelled) return;
        if (!res.ok) {
          if (data.code === "amount_below_stripe_minimum") {
            setProfileOnly(true);
            setError(
              data.message ??
                "Le cumul est inférieur à 0,50 €. Enregistre une carte pour les prochains prélèvements automatiques.",
            );
            return;
          }
          setError(data.message ?? "Impossible d'ouvrir le paiement Stripe.");
          return;
        }
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        setError("Réponse Stripe inattendue.");
      } catch {
        if (!cancelled) setError("Connexion impossible. Réessaie.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cartId, checkoutStatus, checkoutReason]);

  return (
    <div className={cn(segnaMontserrat.className, "mx-auto max-w-md px-5 py-10 text-center")}>
      <h1 className="text-[20px] font-bold text-zinc-900">Régulariser les frais de retard</h1>
      {checkoutStatus === "success" ? (
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-700">{message}</p>
      ) : error ? (
        <p className="mt-4 text-[15px] leading-relaxed text-red-800">{error}</p>
      ) : (
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600">{message}</p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        {checkoutStatus !== "success" && !profileOnly ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-zinc-900 px-5 py-3 text-[15px] font-semibold text-white"
          >
            Réessayer
          </button>
        ) : null}
        {profileOnly ? (
          <Link
            href="/profile?tab=plus"
            className="rounded-full bg-zinc-900 px-5 py-3 text-[15px] font-semibold text-white"
          >
            Ajouter une carte
          </Link>
        ) : null}
        <Link href={`/exchange/emprunt/${cartId}`} className="text-[14px] font-semibold text-zinc-600 underline">
          Retour à mon emprunt
        </Link>
      </div>
    </div>
  );
}
