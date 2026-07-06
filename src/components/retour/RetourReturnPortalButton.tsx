"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SendcloudServicePointPicker } from "@/components/cart/SendcloudServicePointPicker";
import { cn } from "@/lib/utils/cn";
import { trackClientEvent } from "@/lib/analytics/track-client";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";

const btnPrimary = cn(
  segnaMontserrat.className,
  "inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-full bg-black px-4 py-2.5 text-center text-[15px] font-bold leading-none text-white transition hover:bg-zinc-900 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);

const btnSecondary = cn(
  segnaMontserrat.className,
  "inline-flex w-full min-w-0 items-center justify-center rounded-full border border-black bg-white px-4 py-2.5 text-center text-[15px] font-bold leading-none text-black transition hover:bg-zinc-50 active:scale-[0.99] sm:px-5 sm:py-3 sm:text-[16px]",
);

const SYNC_PAUSE_MS = 120_000;

function cartReturnSyncPauseKey(cartId: string) {
  return `segna:cart-return-sync-pause:${cartId}`;
}

function isCartReturnSyncPaused(cartId: string): boolean {
  try {
    const until = sessionStorage.getItem(cartReturnSyncPauseKey(cartId));
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

function pauseCartReturnSync(cartId: string) {
  try {
    sessionStorage.setItem(cartReturnSyncPauseKey(cartId), String(Date.now() + SYNC_PAUSE_MS));
  } catch {
    /* ignore */
  }
}

type Props = {
  cartId: string;
  /** Avant suivi XT : ouvre le portail Sendcloud au clic (crée `cart_return` côté serveur). */
  showPrepareButton?: boolean;
  /** Après suivi XT : lien vers le suivi transporteur. */
  showTrackingButton?: boolean;
  /** Uniquement avec suivi XT : annule le retour Sendcloud et efface le suivi. */
  showResetButton?: boolean;
  /** Retour provisionné BO : annule la commande et bascule sur le portail aller. */
  showLostLabelButton?: boolean;
  /** Bordereau pré-imprimé : carte des points relais à proximité. */
  showRelaySearchButton?: boolean;
  memberPostalCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
};

/**
 * Actions retour membre — aligné sur le flux intake : bordereau au clic, puis suivi + réinitialisation.
 */
export function RetourReturnPortalButton({
  cartId,
  showPrepareButton = false,
  showTrackingButton = false,
  showResetButton = false,
  showLostLabelButton = false,
  showRelaySearchButton = false,
  memberPostalCode = null,
  trackingNumber,
  trackingUrl,
}: Props) {
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lostLabelLoading, setLostLabelLoading] = useState(false);
  const [lostLabelConfirmOpen, setLostLabelConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/return/portal/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        return_portal_url?: string;
      };
      if (!res.ok || !data.ok || !data.return_portal_url?.startsWith("http")) {
        setError(data.error ?? `Erreur ${res.status}`);
        setPortalUrl(null);
        return null;
      }
      setPortalUrl(data.return_portal_url);
      trackClientEvent("order_returned", {
        cart_id: cartId,
        phase: "return_initiated",
      });
      return data.return_portal_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setPortalUrl(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  const syncFromSendcloud = useCallback(async () => {
    if (isCartReturnSyncPaused(cartId)) return;
    try {
      const res = await fetch("/api/cart/return/portal/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; synced?: boolean };
      if (res.ok && data.ok && data.synced) {
        window.location.reload();
      }
    } catch {
      /* ignore */
    }
  }, [cartId]);

  useEffect(() => {
    if (!showPrepareButton || showTrackingButton) return;
    void syncFromSendcloud();
    const timer = window.setInterval(() => void syncFromSendcloud(), 8_000);
    return () => window.clearInterval(timer);
  }, [showPrepareButton, showTrackingButton, syncFromSendcloud]);

  const openPreparePortal = useCallback(async () => {
    const url = portalUrl?.startsWith("http") ? portalUrl : await loadPortal();
    if (url?.startsWith("http")) {
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => void syncFromSendcloud(), 4_000);
    }
  }, [loadPortal, portalUrl, syncFromSendcloud]);

  const reportLostLabel = useCallback(async () => {
    setLostLabelLoading(true);
    setError(null);
    setLostLabelConfirmOpen(false);
    try {
      const res = await fetch("/api/cart/return/provision/lost-label", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        return_portal_url?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        return;
      }
      pauseCartReturnSync(cartId);
      setPortalUrl(null);
      const openedPortalUrl = data.return_portal_url?.trim();
      if (openedPortalUrl?.startsWith("http")) {
        window.open(openedPortalUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => window.location.reload(), 4_000);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLostLabelLoading(false);
    }
  }, [cartId]);

  const resetReturn = useCallback(async () => {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/return/portal/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ cart_id: cartId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        return;
      }
      pauseCartReturnSync(cartId);
      setPortalUrl(null);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setResetting(false);
    }
  }, [cartId]);

  const tu = trackingUrl?.trim().startsWith("http") ? trackingUrl.trim() : null;

  if (!showPrepareButton && !showTrackingButton && !showResetButton && !showLostLabelButton && !showRelaySearchButton) {
    return null;
  }

  return (
    <div className="flex w-full max-w-md flex-col items-stretch gap-3">
      {showRelaySearchButton ? (
        <SendcloudServicePointPicker
          postalCode={memberPostalCode?.replace(/\D/g, "").slice(0, 5) ?? ""}
          carrierFilter="mondial_relay"
          buttonLabel="Trouver un point relais"
          buttonClassName={cn(btnPrimary, "whitespace-nowrap")}
          showMapPinIcon={false}
          onSelect={() => {
            /* Carte informative : le membre choisit un relais de dépôt à proximité. */
          }}
        />
      ) : null}

      {showTrackingButton && tu ? (
        <a href={tu} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          Retourner mon échange
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        </a>
      ) : showTrackingButton && trackingNumber?.trim() ? (
        <p className={cn(segnaMontserrat.className, "text-center text-[15px] font-medium text-zinc-800 sm:text-[16px]")}>
          Numéro de suivi : <span className="font-bold text-black">{trackingNumber.trim()}</span>
        </p>
      ) : null}

      {showPrepareButton ? (
        portalUrl ? (
          <a href={portalUrl} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
            Imprimer mon bordereau
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void openPreparePortal()}
            disabled={loading}
            className={cn(btnPrimary, loading && "cursor-wait bg-zinc-800 hover:bg-zinc-800")}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Préparation du portail…
              </>
            ) : (
              "Imprimer mon bordereau"
            )}
          </button>
        )
      ) : null}

      {showLostLabelButton ? (
        <button
          type="button"
          onClick={() => setLostLabelConfirmOpen(true)}
          disabled={lostLabelLoading || loading || resetting}
          className={cn(
            segnaMontserrat.className,
            "mx-auto text-[14px] font-medium text-red-600 underline underline-offset-2 transition hover:text-red-700 disabled:cursor-wait disabled:opacity-60 sm:text-[15px]",
          )}
        >
          {lostLabelLoading ? "Annulation en cours…" : "J’ai perdu le bordereau"}
        </button>
      ) : null}

      {lostLabelConfirmOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-lost-return-label"
          >
            <SegnaDialogDismissButton onClick={() => setLostLabelConfirmOpen(false)} />
            <h2
              id="confirm-lost-return-label"
              className={segnaDialogTitleClass("pr-10 text-[20px] sm:text-[22px]")}
            >
              Bordereau perdu ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              L’ancien ne sera plus utilisable. Tu pourras en imprimer un nouveau pour déposer ton colis au relais.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLostLabelConfirmOpen(false)}
                disabled={lostLabelLoading}
                className="h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void reportLostLabel()}
                disabled={lostLabelLoading}
                className={cn(
                  "h-10 rounded-lg bg-zinc-900 text-sm font-semibold text-white",
                  lostLabelLoading && "cursor-wait opacity-70",
                )}
              >
                {lostLabelLoading ? "En cours…" : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showResetButton ? (
        <button
          type="button"
          onClick={() => void resetReturn()}
          disabled={resetting || loading}
          className={cn(btnSecondary, (resetting || loading) && "cursor-wait opacity-60")}
        >
          {resetting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Réinitialisation…
            </>
          ) : (
            "Réinitialiser le retour"
          )}
        </button>
      ) : null}

      {error ? (
        <p className="text-center text-[12px] leading-relaxed text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}
