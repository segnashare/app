import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type UserAppStateRow = {
  onboarding_process?: string | null;
  onboarding_mode?: string | null;
};

type UserAppStateClient = {
  from: (table: "users") => {
    select: (columns: string) => {
      eq: (column: "id", value: string) => {
        maybeSingle: () => PromiseLike<{ data: UserAppStateRow | null; error: { message: string } | null }>;
      };
    };
  };
};

export const getCurrentAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { user, error };
});

export const getCurrentUserAppState = cache(async (userId: string) => {
  const supabase = (await createSupabaseServerClient()) as unknown as UserAppStateClient;
  const { data, error } = await supabase
    .from("users")
    .select("onboarding_process,onboarding_mode")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[user-app-state]", error.message);
    }
    return {
      onboarding_process: null,
      onboarding_mode: "real",
    };
  }

  return {
    onboarding_process: data?.onboarding_process ?? null,
    onboarding_mode:
      data?.onboarding_mode === "demo" || data?.onboarding_mode === "bridge" || data?.onboarding_mode === "real"
        ? data.onboarding_mode
        : "real",
  };
});
