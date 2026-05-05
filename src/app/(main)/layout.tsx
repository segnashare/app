import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { MainShell } from "@/components/layout/MainShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MainLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/auth/login");
  }

  const { data: userState } = await supabase
    .from("users")
    .select("onboarding_mode")
    .eq("id", user.id)
    .maybeSingle<{ onboarding_mode?: string | null }>();

  return <MainShell isDemoMode={userState?.onboarding_mode === "demo"}>{children}</MainShell>;
}
