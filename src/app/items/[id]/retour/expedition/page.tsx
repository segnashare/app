import { redirect } from "next/navigation";

import { resolveOuttakeTransferIdForItem } from "@/lib/items/member-outtake-groups";
import { buildOuttakeShippingPageHref } from "@/lib/items/outtake-shipping-metadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Redirection legacy → page regroupement outtake. */
export default async function ItemRetourExpeditionPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const itemId = String(rawId ?? "").trim();
  if (!itemId) redirect("/exchange");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: row } = await supabase
    .from("items")
    .select("id,owner_user_id,deleted_at")
    .eq("id", itemId)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) redirect("/exchange");

  let transferId: string | null = null;
  try {
    const admin = createSupabaseAdminClient();
    transferId = await resolveOuttakeTransferIdForItem(admin, itemId);
  } catch {
    transferId = null;
  }

  redirect(buildOuttakeShippingPageHref(transferId));
}
