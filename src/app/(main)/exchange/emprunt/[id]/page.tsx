import { notFound, redirect } from "next/navigation";

import { EmpruntDetailView } from "@/components/emprunt/EmpruntDetailView";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptValidated,
  memberReceiptAnchorFromOrderShipment,
  shouldTrackAutoOrderReceived,
} from "@/lib/cart/member-receipt-validation";
import { trackOrderReceivedServer } from "@/lib/analytics/track-order-received-server";
import { fetchCartBorrowExtensionDaysTotal } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { fetchMemberCartBorrowOverdue } from "@/lib/cart/fetch-member-cart-borrow-overdue";
import { syncMemberBorrowOverdueAccrual } from "@/lib/cart/sync-member-borrow-overdue-accrual";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { resolveSubscriptionCancelAtPeriodEnd } from "@/lib/subscription/resolve-cancel-at-period-end";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const [membershipLabel, cancelAtPeriodEnd] = await Promise.all([
    resolveMembershipLabel(supabase, userId),
    resolveSubscriptionCancelAtPeriodEnd(supabase, userId),
  ]);
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

  const receiptAnchor = memberReceiptAnchorFromOrderShipment(detail.shipment);
  const confirmedAt = await ensureMemberReceiptAutoConfirmed(supabase, {
    cartId,
    userId,
    memberReceiptConfirmedAt: detail.memberReceiptConfirmedAt,
    shipment: receiptAnchor,
  });
  if (shouldTrackAutoOrderReceived(detail.memberReceiptConfirmedAt, confirmedAt)) {
    trackOrderReceivedServer(userId, cartId, { confirm_source: "auto" });
  }
  if (
    !isMemberReceiptValidated(
      confirmedAt ?? detail.memberReceiptConfirmedAt,
      receiptAnchor,
    )
  ) {
    redirect(`/commande/${cartId}`);
  }

  try {
    const admin = createSupabaseAdminClient();
    await syncMemberBorrowOverdueAccrual(admin, userId);
  } catch (e) {
    console.error("[emprunt] borrow overdue sync", e);
  }

  const [borrowExtensionDaysTotal, borrowOverdue] = await Promise.all([
    fetchCartBorrowExtensionDaysTotal(supabase, cartId),
    fetchMemberCartBorrowOverdue(supabase, cartId),
  ]);

  return (
    <EmpruntDetailView
      detail={detail}
      membershipLabel={membershipLabel}
      cancelAtPeriodEnd={cancelAtPeriodEnd}
      borrowExtensionDaysTotal={borrowExtensionDaysTotal}
      borrowOverdue={borrowOverdue}
    />
  );
}
