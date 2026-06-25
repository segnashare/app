import { notFound } from "next/navigation";

import { BorrowOverdueRegulariserClient } from "@/components/emprunt/BorrowOverdueRegulariserClient";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string; reason?: string }>;
};

export default async function BorrowOverdueRegulariserPage({ params, searchParams }: PageProps) {
  const { id: cartId } = await params;
  const sp = await searchParams;

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

  const { data: cart } = await supabase.from("carts").select("id").eq("id", cartId).eq("user_id", user.id).maybeSingle();
  if (!cart) {
    notFound();
  }

  return (
    <BorrowOverdueRegulariserClient
      cartId={cartId}
      checkoutStatus={sp.checkout ?? null}
      checkoutReason={sp.reason ?? null}
    />
  );
}
