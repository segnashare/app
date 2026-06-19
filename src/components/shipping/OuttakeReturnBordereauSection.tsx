"use client";

import { useState } from "react";

import { SEGNA_PARCEL_WEIGHT_GRAMS } from "@/lib/shipping/exchange-shipping-pricing";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type Props = {
  transferId: string;
  itemIds: string[];
  hasActiveLabel: boolean;
  existingLabelUrl: string | null;
  existingTracking: string | null;
};

export function OuttakeReturnBordereauSection({
  transferId,
  itemIds,
  hasActiveLabel,
  existingLabelUrl,
  existingTracking,
}: Props) {
  const [postalCode, setPostalCode] = useState("");
  const [relayCode, setRelayCode] = useState("");
  const [relayLabel, setRelayLabel] = useState("");
  const [points, setPoints] = useState<Array<{ code: string; label: string }>>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelUrl, setLabelUrl] = useState<string | null>(existingLabelUrl);
  const [tracking, setTracking] = useState<string | null>(existingTracking);

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
          weight_g: SEGNA_PARCEL_WEIGHT_GRAMS,
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
    setLoadingLabel(true);
    setError(null);
    try {
      const cpDigits = postalCode.replace(/\D/g, "").slice(0, 5);
      const res = await fetch("/api/items/outtake/generate-transfer-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: transferId,
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
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "Génération impossible");
        return;
      }
      setLabelUrl(j.label_url ?? null);
      setTracking(j.numero_suivi ?? null);
    } catch {
      setError("Génération impossible");
    } finally {
      setLoadingLabel(false);
    }
  };

  if (hasActiveLabel && labelUrl) {
    return (
      <div className={cn(montserrat.className, "space-y-2 pt-3 text-[14px]")}>
        <p className="font-medium text-zinc-900">Bordereau généré pour ce colis ({itemIds.length} pièce{itemIds.length > 1 ? "s" : ""}).</p>
        {tracking ? <p className="text-zinc-600">Suivi : {tracking}</p> : null}
        <a
          href={labelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
        >
          Ouvrir le bordereau
        </a>
      </div>
    );
  }

  return (
    <div className={cn(montserrat.className, "space-y-3 pt-3")}>
      <p className="text-[14px] leading-relaxed text-zinc-600">
        Segna expédie tes pièces vers le point relais choisi. Un seul bordereau par colis (max 5 pièces).
      </p>
      <label className="block text-sm font-medium text-zinc-800">
        Code postal
        <input
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          placeholder="75017"
        />
      </label>
      <button
        type="button"
        onClick={searchPoints}
        disabled={loadingPoints}
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loadingPoints ? "Recherche…" : "Rechercher les relais"}
      </button>
      {points.length > 0 ? (
        <label className="block text-sm font-medium text-zinc-800">
          Point relais
          <select
            value={relayCode}
            onChange={(e) => {
              const code = e.target.value;
              setRelayCode(code);
              const hit = points.find((p) => p.code === code);
              setRelayLabel(hit?.label ?? code);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            {points.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        onClick={generateLabel}
        disabled={loadingLabel || !relayCode}
        className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loadingLabel ? "Génération…" : "Générer le bordereau du colis"}
      </button>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
