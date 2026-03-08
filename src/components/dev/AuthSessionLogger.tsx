"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthSessionLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const supabase = createSupabaseBrowserClient();

    const logCurrentUser = async (source: string) => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error) {
        console.info("[auth][client]", { source, pathname, error: error.message });
        return;
      }

      console.info("[auth][client]", {
        source,
        pathname,
        userId: user?.id ?? null,
        email: user?.email ?? null,
      });
    };

    void logCurrentUser("page-load");

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      console.info("[auth][client]", {
        source: "auth-state-change",
        event,
        pathname,
        userId: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
      });
    });

    return () => data.subscription.unsubscribe();
  }, [pathname]);

  return null;
}
