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
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    redirect(isMemberIntent ? "/auth/sign-in" : "/auth/sign-up/email");
  }

  const { data } = await supabase
    .from("onboarding_sessions")
    .select("current_step, status")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (data?.status === "completed") {
    redirect("/app");
  }

  if (data?.current_step?.startsWith("/onboarding/")) {
    redirect(data.current_step);
  }

  redirect("/onboarding");
}
