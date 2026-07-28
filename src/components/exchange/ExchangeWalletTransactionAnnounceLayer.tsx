"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { useExchangeWalletAnnouncement } from "@/components/exchange/ExchangeWalletAnnouncementContext";
import { subscribeOnboardingOfferClaimed } from "@/lib/onboarding/onboarding-offer-claimed-event";
import {
  acknowledgeWalletTransaction,
  ensureWalletTransactionAckBaseline,
  shouldAnnounceWalletTransaction,
} from "@/lib/wallet/wallet-transaction-ack-storage";
import {
  hasSeenSegnaXWelcome,
  markSegnaXWelcomeSeen,
} from "@/lib/wallet/segnax-welcome-storage";
import {
  shouldUseSegnaXWelcomeCopy,
  walletTransactionAnnouncementAmountCaption,
  walletTransactionAnnouncementBody,
  walletTransactionAnnouncementCta,
  walletTransactionAnnouncementSignedAmount,
  walletTransactionAnnouncementTitle,
  type WalletTransactionAnnouncement,
} from "@/lib/wallet/wallet-transaction-announcement";
import { cn } from "@/lib/utils/cn";

type ExchangeWalletTransactionAnnounceLayerProps = {
  userId: string;
  /** Pour afficher la bienvenue SegnaX à la 1ʳᵉ arrivée abonnée. */
  membershipLabel?: "Guest" | "Membre +" | "Membre X";
};

async function fetchLatestWalletTransactionAnnouncement(): Promise<WalletTransactionAnnouncement | null> {
  const res = await fetch("/api/wallet/recent-transactions", { credentials: "same-origin" });
  if (!res.ok) return null;
  const json = (await res.json()) as { latestAnnouncement?: WalletTransactionAnnouncement | null };
  return json.latestAnnouncement ?? null;
}

function readSubscriptionSuccessFromUrl(): { success: boolean; plan: string | null } {
  if (typeof window === "undefined") return { success: false, plan: null };
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      success: params.get("subscription") === "success",
      plan: params.get("plan")?.trim().toLowerCase() ?? null,
    };
  } catch {
    return { success: false, plan: null };
  }
}

function clearSubscriptionSuccessFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("subscription") && !url.searchParams.has("plan")) return;
    url.searchParams.delete("subscription");
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

/** Annonce synthétique si le grant n’est pas encore remonté mais l’URL dit succès SegnaX. */
function syntheticSegnaXWelcomeAnnouncement(): WalletTransactionAnnouncement {
  return {
    id: "segnax-welcome-synthetic",
    createdAt: new Date().toISOString(),
    direction: "credit",
    amountPoints: 400,
    label: "Crédits inclus",
    subtitle: "Crédits inclus du mois",
    source: "subscription_monthly_consumption_grant",
    planCode: "segna_x",
  };
}

export function ExchangeWalletTransactionAnnounceLayer({
  userId,
  membershipLabel = "Guest",
}: ExchangeWalletTransactionAnnounceLayerProps) {
  const router = useRouter();
  const announcementCtx = useExchangeWalletAnnouncement();
  const [announcement, setAnnouncement] = useState<WalletTransactionAnnouncement | null>(null);
  const [welcomeCopy, setWelcomeCopy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const syncLatestAnnouncement = useCallback(async () => {
    try {
      const { success: subscriptionSuccess, plan: urlPlan } = readSubscriptionSuccessFromUrl();
      const latest = await fetchLatestWalletTransactionAnnouncement();
      const welcomeAlreadySeen = hasSeenSegnaXWelcome(userId);
      const forceWelcome =
        (subscriptionSuccess && (urlPlan === "segna_x" || urlPlan === "segnax" || !urlPlan)) ||
        (membershipLabel === "Membre X" && !welcomeAlreadySeen);

      if (latest) {
        const useWelcome = shouldUseSegnaXWelcomeCopy(latest, {
          forceWelcome,
          welcomeAlreadySeen,
        });

        // Ne pas baseline-silencer un welcome SegnaX forcé (checkout / 1ʳᵉ visite).
        if (!useWelcome) {
          ensureWalletTransactionAckBaseline(userId, latest.id, latest.createdAt);
        }

        if (useWelcome) {
          setAnnouncement(latest);
          setWelcomeCopy(true);
          setModalOpen(true);
          return;
        }

        if (shouldAnnounceWalletTransaction(userId, latest.id)) {
          setAnnouncement(latest);
          setWelcomeCopy(false);
          setModalOpen(true);
          return;
        }

        ensureWalletTransactionAckBaseline(userId, latest.id, latest.createdAt);
      } else {
        ensureWalletTransactionAckBaseline(userId, null, new Date().toISOString());
      }

      // Checkout OK / 1ʳᵉ visite abonnée mais grant pas encore visible.
      if (forceWelcome) {
        setAnnouncement(syntheticSegnaXWelcomeAnnouncement());
        setWelcomeCopy(true);
        setModalOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, [membershipLabel, userId]);

  useEffect(() => {
    void syncLatestAnnouncement();
  }, [syncLatestAnnouncement]);

  useEffect(() => {
    return subscribeOnboardingOfferClaimed(() => {
      void syncLatestAnnouncement();
    });
  }, [syncLatestAnnouncement]);

  const handleCta = useCallback(() => {
    if (!announcement) return;

    if (welcomeCopy) {
      markSegnaXWelcomeSeen(userId);
    }
    if (!announcement.id.startsWith("segnax-welcome-synthetic")) {
      acknowledgeWalletTransaction(userId, announcement.id, announcement.createdAt);
    }
    clearSubscriptionSuccessFromUrl();
    setModalOpen(false);

    if (welcomeCopy) {
      setAnnouncement(null);
      setWelcomeCopy(false);
      router.push("/shop");
      return;
    }

    announcementCtx?.triggerPillFrameAnimation(announcement, () => {
      setAnnouncement(null);
    });
  }, [announcement, announcementCtx, router, userId, welcomeCopy]);

  const copyOpts = { welcomeCopy };

  return (
    <>
      {modalOpen && announcement ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
          role="presentation"
        >
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative text-left")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-tx-announce-title"
          >
            <h2 id="wallet-tx-announce-title" className={segnaDialogTitleClass()}>
              {walletTransactionAnnouncementTitle(announcement, copyOpts)}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-3")}>
              {walletTransactionAnnouncementBody(announcement, copyOpts)}
            </p>
            <div
              className={cn(
                segnaDialogMontserrat.className,
                "mt-4 flex flex-col items-center justify-center gap-1",
              )}
              aria-label={`${walletTransactionAnnouncementSignedAmount(announcement)} euros`}
            >
              <div className="flex items-center justify-center gap-2.5">
                <span className="text-[28px] font-bold tabular-nums text-zinc-900">
                  {walletTransactionAnnouncementSignedAmount(announcement)}
                </span>
                <span className="text-[28px] font-bold tabular-nums text-zinc-900" aria-hidden>
                  €
                </span>
              </div>
              {walletTransactionAnnouncementAmountCaption(announcement, copyOpts) ? (
                <p className="text-center text-[13px] font-medium text-zinc-500">
                  {walletTransactionAnnouncementAmountCaption(announcement, copyOpts)}
                </p>
              ) : null}
            </div>
            <div className={cn(segnaDialogMontserrat.className, "mt-5")}>
              <button
                type="button"
                onClick={handleCta}
                className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
              >
                {walletTransactionAnnouncementCta(announcement, copyOpts)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
