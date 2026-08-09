"use client";

import { MessageCircle } from "lucide-react";

import { ITEM_CHAT_OPEN_EVENT } from "@/lib/item-chat/client-storage";
import {
  cartDisputeStatusLabel,
  memberCartDisputeCategoryLabel,
} from "@/lib/disputes/member-cart-dispute-categories";
import type { MemberCartDisputeDetail } from "@/lib/disputes/fetch-member-cart-dispute";
import { formatDateTimeParis } from "@/lib/datetime/segna-datetime";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

/** Remplace le bloc Reçu / validation réception quand un litige est ouvert. */
export function CommandeDisputeSection({ dispute }: { dispute: MemberCartDisputeDetail }) {
  const statusLabel = cartDisputeStatusLabel(dispute.status);
  const categoryLabel = memberCartDisputeCategoryLabel(dispute.category, dispute.reportKind);
  const conversationId = dispute.conversationId?.trim() || null;

  return (
    <section className="border-b border-zinc-200 px-5 py-6" aria-label="Litige">
      <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Litige</h2>
      <p className={cn(segnaMontserrat.className, "mt-1.5 text-[13px] leading-snug text-zinc-500")}>
        {statusLabel}
        {" · "}
        {categoryLabel}
      </p>
      <p className={cn(segnaMontserrat.className, "mt-1 text-[13px] leading-snug text-zinc-500")}>
        {formatDateTimeParis(dispute.createdAtIso)}
      </p>
      {dispute.details ? (
        <p className={cn(segnaMontserrat.className, "mt-2 text-[14px] leading-relaxed text-zinc-800")}>
          {dispute.details}
        </p>
      ) : null}
      {dispute.photoUrls.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dispute.photoUrls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element -- URLs signées dynamiques
            <img
              key={url}
              src={url}
              alt=""
              className="h-16 w-16 rounded-[10px] bg-zinc-100 object-cover"
            />
          ))}
        </div>
      ) : null}

      {conversationId ? (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(ITEM_CHAT_OPEN_EVENT, {
                detail: { conversationId },
              }),
            );
          }}
          className={cn(
            segnaMontserrat.className,
            "mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-[14px] font-bold text-zinc-900 transition hover:bg-zinc-50",
          )}
        >
          <MessageCircle className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          Voir la discussion
        </button>
      ) : null}
    </section>
  );
}
