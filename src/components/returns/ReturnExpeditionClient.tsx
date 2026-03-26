"use client";

import { useState } from "react";

type Props = {
  itemId: string;
  canShipNow: boolean;
  existingLabelUrl: string | null;
  existingTracking: string | null;
};

export function ReturnExpeditionClient({ itemId, canShipNow, existingLabelUrl, existingTracking }: Props) {
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
    if (!canShipNow) return;
    setLoadingLabel(true);
    setError(null);
    try {
      const cpDigits = postalCode.replace(/\D/g, "").slice(0, 5);
      const res = await fetch("/api/items/outtake/generate-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          delivery_mode: "relay",
          relay_code: relayCode,
          relay_label: relayLabel,
          mr_relay_product: "24R",
          ...(/^\d{5}$/.test(cpDigits) ? { relay_search_postal_code: cpDigits } : {}),
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; label_url?: string; numero_suivi?: string };
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

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
      {!canShipNow ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Le retour sera activé dès que la pièce repasse en <strong>available/listed</strong>.
        </p>
      ) : null}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-800">
          Code postal (recherche relais)
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
          {loadingPoints ? "Recherche..." : "Rechercher les points relais"}
        </button>
      </div>

      {points.length > 0 ? (
        <label className="block text-sm font-medium text-zinc-800">
          Point relais
          <select
            value={relayCode}
            onChange={(e) => {
              const code = e.target.value;
              setRelayCode(code);
              const row = points.find((p) => p.code === code);
              setRelayLabel(row?.label ?? code);
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
        disabled={!canShipNow || !relayCode || loadingLabel}
        className="w-full rounded-lg bg-[#5E3023] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loadingLabel ? "Génération..." : "Valider l'expédition retour (générer bordereau)"}
      </button>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {labelUrl ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <p>
            Bordereau :{" "}
            <a href={labelUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 underline">
              ouvrir
            </a>
          </p>
          {tracking ? <p>N° suivi : {tracking}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
