"use client";

import Link from "next/link";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { MemberCartOrderReturnShipment } from "@/lib/cart/fetch-member-cart-order-detail";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type Props = {
  cartId: string;
  orderNumberCompact: string;
  initialReturn: MemberCartOrderReturnShipment | null;
};

export function CommandeRetourShippingClient({ cartId, orderNumberCompact, initialReturn }: Props) {
  const [postalCode, setPostalCode] = useState("");
  const [relayCode, setRelayCode] = useState("");
  const [relayLabel, setRelayLabel] = useState("");
  const [points, setPoints] = useState<Array<{ code: string; label: string }>>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [loadingDrop, setLoadingDrop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<MemberCartOrderReturnShipment | null>(initialReturn);

  const labelUrl = returnState?.labelUrl ?? null;
  const tracking = returnState?.trackingNumber ?? null;
  const status = returnState?.status?.toLowerCase() ?? "";
  const commitmentMet = isCartReturnCommitmentMet(returnState?.status);
  const canGenerateLabel = !commitmentMet && (status === "" || status === "pending" || status === "ready");
  const showDepositCta = !commitmentMet && status === "ready" && Boolean(labelUrl);

  const searchPoints = async () => {
    setLoadingPoints(true);
    setError(null);
    try {
      const res = await fetch("/api/items/mondial-relay/relay-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postal_code: postalCode,
          country: "FR",
          weight_g: 900,
          action: "24R",
        }),
      });
      const j = (await res.json()) as { points?: Array<{ code: string; label: string }>; error?: string };
      if (!res.ok) {
        setError(j.error ?? `Erreur ${res.status}`);
        setPoints([]);
        return;
      }
      const list = Array.isArray(j.points) ? j.points : [];
      setPoints(list);
      if (list[0]?.code) {
        setRelayCode(list[0].code);
        setRelayLabel(list[0].label ?? list[0].code);
      }
    } catch {
      setError("Recherche relais impossible");
    } finally {
      setLoadingPoints(false);
    }
  };

  const generateLabel = async () => {
    if (!canGenerateLabel) return;
    setLoadingLabel(true);
    setError(null);
    try {
      const cpDigits = postalCode.replace(/\D/g, "").slice(0, 5);
      const res = await fetch("/api/cart/return/generate-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_id: cartId,
          delivery_mode: "relay",
          relay_code: relayCode,
          relay_label: relayLabel,
          mr_relay_product: "24R",
          ...(/^\d{5}$/.test(cpDigits) ? { relay_search_postal_code: cpDigits } : {}),
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        label_url?: string;
        numero_suivi?: string;
        shipment_id?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "Génération impossible");
        return;
      }
      setReturnState((prev) => ({
        id: j.shipment_id ?? prev?.id ?? "",
        status: "ready",
        createdAt: prev?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackingNumber: j.numero_suivi ?? prev?.trackingNumber ?? null,
        labelUrl: j.label_url ?? null,
      }));
    } catch {
      setError("Génération impossible");
    } finally {
      setLoadingLabel(false);
    }
  };

  const markDroppedOut = async () => {
    if (!showDepositCta) return;
    setLoadingDrop(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/return/mark-dropped-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "Enregistrement impossible");
        return;
      }
      setReturnState((prev) =>
        prev
          ? { ...prev, status: "dropped_out", updatedAt: new Date().toISOString() }
          : {
              id: "",
              status: "dropped_out",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              trackingNumber: null,
              labelUrl,
            },
      );
    } catch {
      setError("Enregistrement impossible");
    } finally {
      setLoadingDrop(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <Link
            href={`/exchange/emprunt/${cartId}`}
            className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Fermer"
          >
            <X className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Retour de l&apos;emprunt
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">Commande {orderNumberCompact}</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-5 pb-8 pt-6">
        <p className="text-[15px] leading-relaxed text-zinc-600">
          Génère ton <span className="font-semibold text-zinc-800">bordereau d&apos;envoi vers Segna</span> pour
          renvoyer tout ton panier en un colis. Choisis le point relais où tu déposeras le paquet.
        </p>

        {commitmentMet ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            Ton retour est pris en charge — ton engagement sur les délais est{" "}
            <span className="font-semibold">réputé respecté</span> dès le dépôt au relais.
          </p>
        ) : null}

        {labelUrl ? (
          <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
            <p className="text-sm font-medium text-zinc-900">Étiquette</p>
            <a
              href={labelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 underline-offset-2 hover:underline"
            >
              Télécharger le PDF
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            {tracking ? (
              <p className="text-xs text-zinc-600">
                Suivi : <span className="font-mono font-medium">{tracking}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {!commitmentMet && canGenerateLabel ? (
          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-800">
                Code postal (recherche relais)
                <input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="ex. 75011"
                />
              </label>
              <button
                type="button"
                onClick={() => void searchPoints()}
                disabled={loadingPoints || postalCode.replace(/\D/g, "").length < 5}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-50"
              >
                {loadingPoints ? "Recherche…" : "Chercher des relais"}
              </button>
            </div>

            {points.length > 0 ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-800">Point relais</label>
                <select
                  value={relayCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setRelayCode(code);
                    const p = points.find((x) => x.code === code);
                    setRelayLabel(p?.label ?? code);
                  }}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  {points.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void generateLabel()}
              disabled={loadingLabel || !relayCode}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-black px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {loadingLabel ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {loadingLabel ? "Génération…" : "Générer le bordereau"}
            </button>
          </section>
        ) : null}

        {showDepositCta ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <p className="text-sm text-violet-950">
              Après avoir déposé ton colis au point relais, confirme ici pour valider ton engagement de retour dans les
              délais.
            </p>
            <button
              type="button"
              onClick={() => void markDroppedOut()}
              disabled={loadingDrop}
              className="mt-3 w-full rounded-full border border-violet-700/30 bg-white px-4 py-2.5 text-sm font-semibold text-violet-950 disabled:opacity-50"
            >
              {loadingDrop ? "…" : "J’ai déposé le colis au point relais"}
            </button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
