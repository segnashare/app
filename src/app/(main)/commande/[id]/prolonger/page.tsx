import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { CommandeProlongerClient } from "@/components/commande/CommandeProlongerClient";
import { fetchCartBorrowExtensionDaysTotal } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

export default async function CommandeProlongerPage({ params }: PageProps) {
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

  const shipSt = detail.shipment?.status?.toLowerCase() ?? "";
  if (shipSt !== "delivered") {
    redirect(`/commande/${cartId}`);
  }

  if (detail.lines.length === 0) {
    redirect(`/exchange/emprunt/${cartId}`);
  }

  const existingExtensionDays = await fetchCartBorrowExtensionDaysTotal(supabase, cartId);

  return (
    <Suspense fallback={null}>
      <CommandeProlongerClient
        cartId={cartId}
        orderNumberCompact={detail.orderNumberCompact}
        lines={detail.lines}
        creditKind={detail.walletCreditKind}
        existingExtensionDays={existingExtensionDays}
      />
    </Suspense>
  );
}
