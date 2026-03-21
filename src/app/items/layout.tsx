import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { MainShell } from "@/components/layout/MainShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ItemsLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/auth/sign-in");
  }

  return <MainShell>{children}</MainShell>;
}
