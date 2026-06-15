import { redirect } from "next/navigation";

import { MemberIntakeVerificationContent } from "@/components/verification/MemberIntakeVerificationContent";
import { fetchMemberIntakeVerificationPage } from "@/lib/items/member-intake-verification";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ transferId: string }>;
};

export default async function MemberIntakeVerificationPage({ params }: Props) {
  const { transferId: rawTransferId } = await params;
  const transferId = String(rawTransferId ?? "").trim();
  if (!transferId) {
    redirect("/exchange");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const snapshot = await fetchMemberIntakeVerificationPage(
    createSupabaseAdminClient(),
    user.id,
    transferId,
  );
  if (!snapshot) {
    redirect("/exchange");
  }

  return <MemberIntakeVerificationContent snapshot={snapshot} />;
}
