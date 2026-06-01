"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";

import { IntakePendingShippingGateModal } from "@/components/items/IntakePendingShippingGateModal";
import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";
import { cn } from "@/lib/utils/cn";

type ExchangeProposePieceButtonProps = {
  guideExchangeOnboarding?: boolean;
  /** Pièces validées en phase expédition (`ready` / `shipping`). */
  pendingShippingItemIds: string[];
  /** Envois séparés (post-split) : pas de page shipping groupée. */
  shipmentsSplit?: boolean;
};

export function ExchangeProposePieceButton({
  guideExchangeOnboarding = false,
  pendingShippingItemIds,
  shipmentsSplit = false,
}: ExchangeProposePieceButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const blockNewProposal = pendingShippingItemIds.length >= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS;

  const buttonClassName = cn(
    "segna-guidance-shimmer-target inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900",
    guideExchangeOnboarding && "segna-guidance-shimmer-active",
  );

  return (
    <>
      {blockNewProposal ? (
        <button type="button" onClick={() => setModalOpen(true)} className={buttonClassName}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Proposer une pièce
        </button>
      ) : (
        <Link href="/items/new?fresh=1" className={buttonClassName}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Proposer une pièce
        </Link>
      )}

      <IntakePendingShippingGateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        purpose="propose_piece"
        pendingItemIds={pendingShippingItemIds}
        shipmentsSplit={shipmentsSplit}
      />
    </>
  );
}
