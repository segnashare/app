"use client";

import { useCallback, useEffect, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { useExchangeWalletAnnouncement } from "@/components/exchange/ExchangeWalletAnnouncementContext";
import {
  acknowledgeWalletTransaction,
  ensureWalletTransactionAckBaseline,
  shouldAnnounceWalletTransaction,
} from "@/lib/wallet/wallet-transaction-ack-storage";
import {
  walletTransactionAnnouncementBody,
  walletTransactionAnnouncementCta,
  walletTransactionAnnouncementSignedAmount,
  walletTransactionAnnouncementTitle,
  type WalletTransactionAnnouncement,
} from "@/lib/wallet/wallet-transaction-announcement";
import { SEGNA_CREDIT_ICON_SRC } from "@/lib/brand/segna-mark";
import { cn } from "@/lib/utils/cn";

type ExchangeWalletTransactionAnnounceLayerProps = {
  userId: string;
};

export function ExchangeWalletTransactionAnnounceLayer({ userId }: ExchangeWalletTransactionAnnounceLayerProps) {
  const announcementCtx = useExchangeWalletAnnouncement();
  const [announcement, setAnnouncement] = useState<WalletTransactionAnnouncement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/wallet/recent-transactions", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) return { latestAnnouncement: null as WalletTransactionAnnouncement | null };
        return (await res.json()) as { latestAnnouncement?: WalletTransactionAnnouncement | null };
      })
      .then((json) => {
        if (cancelled) return;
        const latest = json.latestAnnouncement ?? null;
        if (!latest) {
          ensureWalletTransactionAckBaseline(userId, null, new Date().toISOString());
          return;
        }

        ensureWalletTransactionAckBaseline(userId, latest.id, latest.createdAt);

        if (shouldAnnounceWalletTransaction(userId, latest.id)) {
          setAnnouncement(latest);
          setModalOpen(true);
        }
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleCta = useCallback(() => {
    if (!announcement) return;

    acknowledgeWalletTransaction(userId, announcement.id, announcement.createdAt);
    setModalOpen(false);

    announcementCtx?.triggerPillFrameAnimation(announcement, () => {
      setAnnouncement(null);
    });
  }, [announcement, announcementCtx, userId]);

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
              {walletTransactionAnnouncementTitle()}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-3")}>{walletTransactionAnnouncementBody(announcement)}</p>
            <div
              className={cn(
                segnaDialogMontserrat.className,
                "mt-4 flex items-center justify-center gap-2.5",
              )}
              aria-label={`${walletTransactionAnnouncementSignedAmount(announcement)} crédits`}
            >
              <span className="text-[28px] font-bold tabular-nums text-zinc-900">
                {walletTransactionAnnouncementSignedAmount(announcement)}
              </span>
              <img src={SEGNA_CREDIT_ICON_SRC} alt="" className="h-8 w-8 shrink-0 object-contain" aria-hidden />
            </div>
            <div className={cn(segnaDialogMontserrat.className, "mt-5")}>
              <button
                type="button"
                onClick={handleCta}
                className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
              >
                {walletTransactionAnnouncementCta(announcement)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
