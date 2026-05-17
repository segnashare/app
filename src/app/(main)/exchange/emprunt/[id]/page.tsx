import { notFound, redirect } from "next/navigation";

import { EmpruntDetailView } from "@/components/emprunt/EmpruntDetailView";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchCartBorrowExtensionDaysTotal } from "@/lib/cart/fetch-cart-borrow-extension-days";
import {
  applyBorrowExtensionDaysToDeadlineMs,
  computeBorrowDeadlineMs,
  resolveOutboundBorrowDeliveredAtIso,
} from "@/lib/emprunt/borrow-period";
import { isActiveMemberReturnPhase } from "@/lib/cart/member-return-shipment-copy";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETURN_ENFORCE_WINDOW_MS = 48 * 60 * 60 * 1000;

type PageProps = { params: Promise<{ id: string }> };

function isDeliveredToMember(detail: Awaited<ReturnType<typeof fetchMemberCartOrderDetail>>): boolean {
  if (!detail?.shipment) return false;
  return detail.shipment.status.toLowerCase() === "delivered";
}

export default async function EmpruntPage({ params }: PageProps) {
  const { id: cartId } = await params;
  if (!CART_ID_RE.test(cartId)) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const userId = user.id as string;
  const membershipLabel = await resolveMembershipLabel(supabase, userId);
  const detail = await fetchMemberCartOrderDetail(
    supabase,
    userId,
    cartId,
    walletCreditKindForMembership(membershipLabel),
  );
  if (!detail) {
    notFound();
  }

  if (!isDeliveredToMember(detail)) {
    redirect(`/commande/${cartId}`);
  }

  const borrowExtensionDaysTotal = await fetchCartBorrowExtensionDaysTotal(supabase, cartId);
  const borrowAnchorIso = resolveOutboundBorrowDeliveredAtIso(detail.shipment?.deliveredAt, detail.shipment?.updatedAt);
  const deliveredAtMs = borrowAnchorIso ? Date.parse(borrowAnchorIso) : Number.NaN;
  const returnDeadlineMs = applyBorrowExtensionDaysToDeadlineMs(
    computeBorrowDeadlineMs(deliveredAtMs, membershipLabel),
    borrowExtensionDaysTotal,
  );
  const mustUseReturnPage =
    isActiveMemberReturnPhase(detail.returnShipment?.status) &&
    Number.isFinite(returnDeadlineMs) &&
    returnDeadlineMs - Date.now() <= RETURN_ENFORCE_WINDOW_MS;

  if (mustUseReturnPage) {
    redirect(`/exchange/retour/${cartId}`);
  }

  return (
    <EmpruntDetailView
      detail={detail}
      membershipLabel={membershipLabel}
      borrowExtensionDaysTotal={borrowExtensionDaysTotal}
    />
  );
}
