import { redirect } from "next/navigation";

import { resolveMemberIntakeTransferIdForItem } from "@/lib/items/member-intake-verification";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ itemId: string }>;
};

/** Redirige vers `/verification/[transferId]` depuis une pièce en vérification. */
export default async function MemberIntakeVerificationByItemPage({ params }: Props) {
  const { itemId: rawItemId } = await params;
  const itemId = String(rawItemId ?? "").trim();
  if (!itemId) {
    redirect("/exchange");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const transferId = await resolveMemberIntakeTransferIdForItem(
    createSupabaseAdminClient(),
    itemId,
    user.id,
  );
  if (!transferId) {
    redirect("/exchange");
  }

  redirect(`/verification/${encodeURIComponent(transferId)}`);
}
