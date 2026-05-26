import { redirect } from "next/navigation";

import {
  buildIntakeShippingPageHrefFromIds,
  fetchDefaultIntakeShippingGroupIds,
} from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ id: string }>;
};

/** Même écran que `/items/shipping` : si étiquette fusionnée BO, ouvre la page avec tous les `ids` du lot. */
export default async function ItemFulfillmentPage({ params }: Props) {
  const { id: itemId } = await params;
  const id = String(itemId ?? "").trim();
  if (!id) {
    redirect("/exchange");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const { data: row } = await supabase
    .from("items")
    .select("id, item_intake(metadata)")
    .eq("id", id)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!row) {
    redirect("/exchange");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirect(`/items/shipping?ids=${encodeURIComponent(id)}`);
  }

  const groupIds = await fetchDefaultIntakeShippingGroupIds(admin, user.id, { focusItemId: id });
  redirect(
    groupIds.length >= 2 ? buildIntakeShippingPageHrefFromIds(groupIds) : `/items/shipping?ids=${encodeURIComponent(id)}`,
  );
}
