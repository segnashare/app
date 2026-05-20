import { notFound } from "next/navigation";

import { CommandeDeclareProblemeClient } from "@/components/commande/CommandeDeclareProblemeClient";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
};

export default async function CommandeProblemePage({ params, searchParams }: PageProps) {
  const { id: cartId } = await params;
  const { kind: kindParam } = await searchParams;
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
  const backHref = `/commande/${cartId}`;
  const kindOverride = kindParam === "borrow" || kindParam === "reception" ? kindParam : null;
  const reportKind =
    kindOverride ?? (isDelivered ? ("reception" as const) : ("borrow" as const));

  return (
    <CommandeDeclareProblemeClient
      cartId={cartId}
      orderNumberCompact={detail.orderNumberCompact}
      backHref={backHref}
      lines={detail.lines}
      reportKind={reportKind}
    />
  );
}
