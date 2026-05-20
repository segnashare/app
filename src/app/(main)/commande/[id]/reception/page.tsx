import { notFound } from "next/navigation";

import { CommandeDeclareProblemeClient } from "@/components/commande/CommandeDeclareProblemeClient";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  isMemberReceiptValidated,
  memberReceiptAnchorFromOrderShipment,
} from "@/lib/cart/member-receipt-validation";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

export default async function CommandeReceptionProblemePage({ params }: PageProps) {
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

  const isDelivered = detail.shipment?.status.toLowerCase() === "delivered";
  const receiptValidated =
    isDelivered &&
    isMemberReceiptValidated(
      detail.memberReceiptConfirmedAt,
      memberReceiptAnchorFromOrderShipment(detail.shipment),
    );
  const backHref = receiptValidated ? `/exchange/emprunt/${cartId}` : `/commande/${cartId}`;

  return (
    <CommandeDeclareProblemeClient
      cartId={cartId}
      orderNumberCompact={detail.orderNumberCompact}
      backHref={backHref}
      lines={detail.lines}
      reportKind="reception"
    />
  );
}
