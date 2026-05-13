import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthStartPageProps = {
  searchParams: Promise<{ intent?: string }>;
};

export default async function AuthStartPage({ searchParams }: AuthStartPageProps) {
  const { intent } = await searchParams;
  const isMemberIntent = intent === "member";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(isMemberIntent ? "/auth/login?from=member" : "/auth/sign-up/email");
  }

  if (isMemberIntent) {
    redirect("/auth/login?from=member");
  }

  redirect("/shop");
}
