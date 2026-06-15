"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function PostHogAuthTracker(): null {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      if (user) {
        posthog.identify(user.id, {
          email: user.email ?? undefined,
        });
        return;
      }

      if (event === "SIGNED_OUT") {
        posthog.reset();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
