import { notFound, redirect } from "next/navigation";

import { CommandeDetailView } from "@/components/commande/CommandeDetailView";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { ensureGuestPurchaseStripeInvoiceForCartOrder } from "@/lib/stripe/guest-purchase-stripe-invoice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptValidated,
  memberReceiptAnchorFromOrderShipment,
  shouldTrackAutoOrderReceived,
} from "@/lib/cart/member-receipt-validation";
import { trackOrderReceivedServer } from "@/lib/analytics/track-order-received-server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type PageProps = { params: Promise<{ id: string }> };

export default async function CommandeDetailPage({ params }: PageProps) {
  const { id: cartId } = await params;
  if (!CART_ID_RE.test(cartId)) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- aligné page Échange (client Supabase serveur)
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const userId = user.id as string;
  const membershipLabel = await resolveMembershipLabel(supabase, userId);

  try {
    const admin = createSupabaseAdminClient();
    await ensureGuestPurchaseStripeInvoiceForCartOrder(admin, userId, cartId);
  } catch (e) {
    console.error("[commande] ensureGuestPurchaseStripeInvoiceForCartOrder", cartId, e);
  }

  const detail = await fetchMemberCartOrderDetail(
    supabase,
    userId,
    cartId,
    walletCreditKindForMembership(membershipLabel),
  );
  if (!detail) {
    notFound();
  }

  const shipSt = detail.shipment?.status?.toLowerCase() ?? "";

  const receiptAnchor = memberReceiptAnchorFromOrderShipment(detail.shipment);
  if (shipSt === "delivered" && receiptAnchor && !detail.isPurchaseOrder) {
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
      isMemberReceiptValidated(
        confirmedAt ?? detail.memberReceiptConfirmedAt,
        receiptAnchor,
      )
    ) {
      redirect(`/exchange/emprunt/${cartId}`);
    }
  }

  return (
    <CommandeDetailView detail={detail} membershipLabel={membershipLabel} />
  );
}
