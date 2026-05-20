"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  cartId: string;
  rentalDurationLabel: string;
  receiptAlreadyConfirmed: boolean;
};

const bodyText = cn("text-[15px] leading-relaxed text-zinc-800", segnaMontserrat.className);

const btnPrimary = cn(
  segnaMontserrat.className,
  "flex h-12 w-full items-center justify-center rounded-full bg-zinc-950 text-[15px] font-bold text-white transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
);

export function CommandeReceptionExchangeSection({
  cartId,
  rentalDurationLabel,
  receiptAlreadyConfirmed,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmReceipt() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cartId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Validation impossible. Réessaie.");
        return;
      }
      router.push(`/exchange/emprunt/${cartId}`);
      router.refresh();
    } catch {
      setError("Validation impossible. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  if (receiptAlreadyConfirmed) {
    return (
      <section className="border-b border-zinc-200 px-5 py-6">
        <p className={bodyText}>Réception validée — consulte ton emprunt pour gérer le retour.</p>
        <Link href={`/exchange/emprunt/${cartId}`} className={cn(btnPrimary, "mt-4")}>
          Voir mon emprunt
        </Link>
      </section>
    );
  }

  return (
    <section
      className={cn(
        segnaMontserrat.className,
        "flex flex-col items-center border-b border-zinc-200 bg-white px-5 py-6",
      )}
    >
      <div className="relative mx-auto w-full max-w-[220px] shrink-0">
        <Image
          src="/ressources/oeil_charme.png"
          alt=""
          width={480}
          height={480}
          className="mx-auto h-auto w-full max-h-[180px] object-contain"
        />
      </div>

      <div className="mt-5 w-full max-w-[22rem] space-y-3">
        <p className={bodyText}>
          Durée de location : <span className="font-semibold text-zinc-950">{rentalDurationLabel}</span>
        </p>
        <p className={bodyText}>
          Vérifie le contenu de ta box et valide la réception si tout est conforme.
        </p>

        <div className="flex flex-col gap-2.5 pt-3">
          <button type="button" disabled={busy} onClick={() => void handleConfirmReceipt()} className={btnPrimary}>
            {busy ? "Validation…" : "Valider la bonne réception"}
          </button>
          <Link
            href={`/commande/${cartId}/probleme`}
            className={cn(
              segnaMontserrat.className,
              "py-2 text-center text-[15px] font-medium text-zinc-950 underline underline-offset-2",
            )}
          >
            Déclarer un problème
          </Link>
        </div>

        {error ? (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
