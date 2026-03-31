import type { ReactNode } from "react";

import { PaymentHoldReleaseBoundary } from "@/components/cart/PaymentHoldReleaseBoundary";
import { fetchActiveCartSummaryForUser } from "@/lib/cart/fetch-active-cart-lines";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CartPaymentLayout({ children }: { children: ReactNode }) {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cartId =
    user != null ? (await fetchActiveCartSummaryForUser(supabase, user.id as string)).cartId : null;

  return <PaymentHoldReleaseBoundary activeCartId={cartId}>{children}</PaymentHoldReleaseBoundary>;
}
