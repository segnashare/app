"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { MemberCartOrderReturnShipment } from "@/lib/cart/fetch-member-cart-order-detail";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";

type Props = {
  cartId: string;
  initialReturn: MemberCartOrderReturnShipment | null;
  /** Faux sur la page retour : les textes explicatifs sont dans le bloc œil. */
  showExplainer?: boolean;
};

type AutoPhase = "idle" | "trying" | "done" | "failed" | "skipped";

/** Bloc étiquette / auto-génération — utilisé par la page suivi retour (shell serveur séparé). */
export function RetourShippingFormClient({
  cartId,
  initialReturn,
  showExplainer = true,
}: Props) {
  const [returnState, setReturnState] = useState<MemberCartOrderReturnShipment | null>(initialReturn);
  const [autoPhase, setAutoPhase] = useState<AutoPhase>("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoAttemptId, setAutoAttemptId] = useState(0);
  const triedRef = useRef(false);

  const labelUrl = returnState?.labelUrl ?? null;
  const status = returnState?.status?.toLowerCase() ?? "";
  const commitmentMet = isCartReturnCommitmentMet(returnState?.status);
  const canGenerateLabel = !commitmentMet && (status === "" || status === "pending" || status === "ready");

  useEffect(() => {
    if (triedRef.current) return;
    if (!canGenerateLabel) {
      setAutoPhase("skipped");
      return;
    }
    if (labelUrl) {
      setAutoPhase("done");
      return;
    }

    let cancelled = false;
    triedRef.current = true;
    setAutoPhase("trying");
    setAutoError(null);

    void (async () => {
      const res = await fetch("/api/cart/return/auto-generate-label", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        developer_hint?: string;
        label_url?: string;
        numero_suivi?: string;
        shipment_id?: string;
      };
      if (cancelled) return;
      if (res.ok && j.ok) {
        setAutoPhase("done");
        setReturnState((prev) => ({
          id: typeof j.shipment_id === "string" ? j.shipment_id : prev?.id ?? "",
          status: "ready",
          createdAt: prev?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          trackingNumber: typeof j.numero_suivi === "string" ? j.numero_suivi : prev?.trackingNumber ?? null,
          memberTrackingUrl: prev?.memberTrackingUrl ?? null,
          labelUrl: typeof j.label_url === "string" ? j.label_url : null,
          preprintedReturnLabel: prev?.preprintedReturnLabel ?? false,
        }));
        return;
      }
      setAutoPhase("failed");
      const hint = typeof j.developer_hint === "string" && j.developer_hint.trim() ? `\n${j.developer_hint.trim()}` : "";
      setAutoError(`${j.error ?? `Erreur ${res.status}`}${hint}`.trim());
    })();

    return () => {
      cancelled = true;
    };
  }, [canGenerateLabel, cartId, labelUrl, autoAttemptId]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 pb-8 pt-1">
      {showExplainer ? (
        <>
          <p className="text-[15px] leading-relaxed text-zinc-600">
            Nous préparons ton <span className="font-semibold text-zinc-800">bordereau d&apos;envoi vers Segna</span>{" "}
            (point relais près de ton adresse — gratuit, déjà inclus dans ton paiement à l&apos;emprunt). Une fois
            l&apos;étiquette prête, imprime-la et dépose ton colis au relais indiqué sur le PDF.
          </p>
          <p className="text-[13px] leading-relaxed text-zinc-500">
            La suite du trajet (transit, réception à Segna, vérification) est pilotée depuis le back-office Segna — tu
            n&apos;as rien à valider ici après le dépôt.
          </p>
        </>
      ) : null}

      {commitmentMet ? (
        <p className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Ton retour est pris en charge — ton engagement sur les délais est{" "}
          <span className="font-semibold">réputé respecté</span> dès le dépôt au relais.
        </p>
      ) : null}

      {autoPhase === "trying" ? (
        <div className="flex w-full items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Génération de l&apos;étiquette…
        </div>
      ) : null}

      {autoPhase === "failed" ? (
        <div className="w-full space-y-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
          <p className="text-sm text-rose-900">{autoError ?? "Génération impossible."}</p>
          <button
            type="button"
            onClick={() => {
              triedRef.current = false;
              setAutoPhase("idle");
              setAutoError(null);
              setAutoAttemptId((x) => x + 1);
            }}
            className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-950"
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {labelUrl ? (
        <div className="flex w-full flex-col items-center gap-3 pt-2">
          <a
            href={labelUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="inline-flex w-full max-w-sm items-center justify-center rounded-full bg-black px-5 py-3 text-center text-[15px] font-bold text-white transition hover:bg-zinc-900"
          >
            Télécharger le bordereau (PDF)
          </a>
          <a
            href={labelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-[13px] font-medium text-zinc-600 underline decoration-zinc-400 underline-offset-[4px] hover:text-zinc-900"
          >
            Ouvrir dans un nouvel onglet
          </a>
        </div>
      ) : null}
    </div>
  );
}
