"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { formatMemberReceiptAutoConfirmRemainingFr } from "@/lib/cart/member-receipt-validation";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  cartId: string;
  rentalDurationLabel: string;
  receiptAlreadyConfirmed: boolean;
  /** Instant UTC où l’auto-validation interviendra (livraison + 24 h). */
  autoConfirmEligibleAtIso?: string | null;
};

const bodyText = cn("text-[15px] leading-relaxed text-zinc-800", segnaMontserrat.className);

const btnPrimary = cn(
  segnaMontserrat.className,
  "flex h-12 w-full items-center justify-center rounded-full bg-zinc-950 text-[15px] font-bold text-white transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50",
);

function useAutoConfirmCountdownLabel(eligibleAtIso: string | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(() => {
    if (!eligibleAtIso) return null;
    const eligibleMs = Date.parse(eligibleAtIso);
    if (Number.isNaN(eligibleMs)) return null;
    return formatMemberReceiptAutoConfirmRemainingFr(eligibleMs - Date.now());
  });

  useEffect(() => {
    if (!eligibleAtIso) {
      setLabel(null);
      return;
    }
    const eligibleMs = Date.parse(eligibleAtIso);
    if (Number.isNaN(eligibleMs)) {
      setLabel(null);
      return;
    }

    function tick() {
      setLabel(formatMemberReceiptAutoConfirmRemainingFr(eligibleMs - Date.now()));
    }

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [eligibleAtIso]);

  return label;
}

export function CommandeReceptionExchangeSection({
  cartId,
  rentalDurationLabel,
  receiptAlreadyConfirmed,
  autoConfirmEligibleAtIso = null,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoConfirmLabel = useAutoConfirmCountdownLabel(autoConfirmEligibleAtIso);

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
      trackClientEvent("order_received", { cart_id: cartId, manual_confirm: true });
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
        {autoConfirmLabel ? (
          <p className={cn(bodyText, "text-zinc-600")}>{autoConfirmLabel}</p>
        ) : null}

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
