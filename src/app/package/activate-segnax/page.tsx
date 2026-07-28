"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";

/** Essai gratuit « 1 mois offert » côté Stripe. */
const TRIAL_PERIOD_DAYS = 30;

/**
 * Entrée website → Stripe Checkout SegnaX (trial 30 j + empreinte 100 €).
 * Utilisée après handoff `/auth/handoff#…&type=website_activate_segnax`.
 */
export default function ActivateSegnaXPage() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [message, setMessage] = useState("Préparation du paiement…");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const cancelReturnPath = `${getWebsiteOrigin()}/abonnement/recap?checkout=cancelled`;
        const response = await fetch("/api/stripe/subscription/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode: "segna_x",
            trialPeriodDays: TRIAL_PERIOD_DAYS,
            bankHold: true,
            cancelReturnPath,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          url?: string;
          message?: string;
        } | null;

        if (response.status === 401) {
          setMessage("Session expirée. Redirection…");
          router.replace("/auth/login?from=member");
          return;
        }

        if (!response.ok || !payload?.url) {
          throw new Error(payload?.message ?? "Impossible de lancer le checkout SegnaX.");
        }

        window.location.assign(payload.url);
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Impossible de lancer le paiement.";
        setMessage(text);
        window.setTimeout(() => {
          window.location.assign(`${getWebsiteOrigin()}/abonnement/recap?checkout=error`);
        }, 2200);
      }
    })();
  }, [router]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-6">
      <p className="text-center text-sm font-medium text-zinc-700">{message}</p>
    </main>
  );
}
