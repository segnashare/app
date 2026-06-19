"use client";

import Script from "next/script";
import { MapPin } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CheckoutRelaySelection } from "@/lib/cart/checkout-delivery-storage";

const SPP_SCRIPT = "https://embed.sendcloud.sc/spp/1.0.0/api.min.js";

type SppConfig = {
  enabled: boolean;
  api_key?: string;
  country?: string;
  language?: string;
  carriers?: string[];
};

export type SendcloudSppSelection = CheckoutRelaySelection;

type RawSppResult = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapSppResultToSelection(raw: RawSppResult, fallbackPostal: string): SendcloudSppSelection | null {
  const id =
    num(raw.id) ??
    num(raw.service_point_id) ??
    num((raw.service_point as RawSppResult | undefined)?.id);
  if (id == null) return null;

  const carrier = str(raw.carrier).toLowerCase() || str(raw.carrier_name).toLowerCase() || undefined;
  const name = str(raw.name) || str(raw.shop_name) || "Point relais";
  const street = [str(raw.street), str(raw.house_number)].filter(Boolean).join(" ");
  const postalCode = str(raw.postal_code) || str(raw.zipcode) || fallbackPostal;
  const city = str(raw.city);
  const code =
    str(raw.code) ||
    (carrier === "mondial_relay" && str(raw.carrier_code)
      ? `FR-${str(raw.carrier_code).replace(/^FR-?/i, "")}`
      : `sc-${id}`);

  const label = [name, street, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(" — ");

  return {
    code,
    label: label.slice(0, 220),
    postalCode,
    city: city || undefined,
    sendcloudServicePointId: id,
    sendcloudCarrier: carrier,
    sendcloudPostNumber: str(raw.post_number) || str(raw.to_post_number) || undefined,
  };
}

declare global {
  interface Window {
    sendcloud?: {
      servicePoints: {
        open: (
          config: Record<string, unknown>,
          onSuccess: (result: RawSppResult) => void,
          onFailure?: (error: unknown) => void,
        ) => void;
      };
    };
  }
}

function isSendcloudSppApiReady(): boolean {
  return typeof window !== "undefined" && Boolean(window.sendcloud?.servicePoints?.open);
}

type Props = {
  postalCode: string;
  onSelect: (selection: SendcloudSppSelection) => void;
  disabled?: boolean;
  /** Limite la carte au transporteur choisi (chronopost | mondial_relay). */
  carrierFilter?: string | null;
};

export function SendcloudServicePointPicker({
  postalCode,
  onSelect,
  disabled = false,
  carrierFilter = null,
}: Props) {
  const [config, setConfig] = useState<SppConfig | null>(null);
  const [scriptReady, setScriptReady] = useState(() => isSendcloudSppApiReady());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSendcloudSppApiReady()) {
      setScriptReady(true);
      return;
    }
    const id = window.setInterval(() => {
      if (isSendcloudSppApiReady()) {
        setScriptReady(true);
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/items/sendcloud/spp-config");
        const j = (await res.json()) as SppConfig;
        if (!cancelled) setConfig(j.enabled ? j : { enabled: false });
      } catch {
        if (!cancelled) setConfig({ enabled: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const configReady = Boolean(config?.enabled && config.api_key);
  const pickerReady = configReady && scriptReady && isSendcloudSppApiReady();

  const openPicker = useCallback(() => {
    const sppConfig = config;
    if (!sppConfig?.enabled || !sppConfig.api_key) {
      setError("Carte relais Sendcloud indisponible.");
      return;
    }
    if (!pickerReady || !window.sendcloud?.servicePoints?.open) {
      return;
    }

    setLoading(true);
    setError(null);

    const pc = postalCode.replace(/\D/g, "").slice(0, 5);
    const openConfig: Record<string, unknown> = {
      apiKey: sppConfig.api_key,
      country: sppConfig.country ?? "FR",
      language: sppConfig.language ?? "fr-fr",
    };
    if (pc.length === 5) openConfig.postalCode = pc;
    const filter = carrierFilter?.trim();
    if (filter) {
      openConfig.carriers = filter;
    } else if (sppConfig.carriers?.length) {
      openConfig.carriers = sppConfig.carriers.join(",");
    }

    window.sendcloud.servicePoints.open(
      openConfig,
      (result) => {
        setLoading(false);
        const mapped = mapSppResultToSelection(result, pc || "75000");
        if (!mapped) {
          setError("Sélection invalide. Choisis un autre point relais.");
          return;
        }
        onSelect(mapped);
      },
      (fail) => {
        setLoading(false);
        let msg = "Carte fermée ou erreur Sendcloud.";
        if (fail && typeof fail === "object") {
          const o = fail as Record<string, unknown>;
          if (typeof o.message === "string") msg = o.message;
          else if (typeof o.carrier === "string") msg = o.carrier;
          else if (Array.isArray(o.errors) && o.errors[0] && typeof o.errors[0] === "object") {
            const e0 = o.errors[0] as Record<string, unknown>;
            msg = String(e0.carrier ?? e0.message ?? msg);
          }
        }
        if (/n'ont pas encore été activés|not been activated/i.test(msg)) {
          msg =
            "Un transporteur demandé n’est pas activé dans Sendcloud → Intégrations → Segna → Points relais. Réessaie après avoir coché les bons transporteurs (ex. Mondial Relay + Colissimo).";
        }
        setError(msg.slice(0, 280));
      },
    );
  }, [carrierFilter, config, onSelect, pickerReady, postalCode]);

  if (config && !config.enabled) return null;

  return (
    <>
      <Script
        src={SPP_SCRIPT}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Impossible de charger la carte Sendcloud.")}
      />
      <button
        type="button"
        disabled={disabled || loading || !pickerReady}
        onClick={() => openPicker()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-zinc-900 bg-white px-4 py-3 text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
      >
        <MapPin className="h-5 w-5 shrink-0" aria-hidden />
        {loading ? "Ouverture…" : !pickerReady ? "Chargement de la carte…" : "Choisir un point relais"}
      </button>
      {error ? <p className="mt-2 text-[13px] text-red-600">{error}</p> : null}
    </>
  );
}
