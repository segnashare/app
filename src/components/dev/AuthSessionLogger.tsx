"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildSessionCacheKey, upsertSessionLog } from "@/lib/supabase/userSessions";

const isExpectedInvalidSessionError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("user from sub claim in jwt does not exist") ||
    normalized.includes("authenticated user does not exist in auth.users")
  );
};

export function AuthSessionLogger() {
  const pathname = usePathname();
  const lastLoggedSessionRef = useRef<string | null>(null);
  const invalidSessionRef = useRef(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const logEnabled = process.env.NODE_ENV === "development";

    const logCurrentUser = async (source: string) => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (logEnabled && error) {
        console.info("[auth][client]", { source, pathname, error: error.message });
        return;
      }

      if (logEnabled) {
        console.info("[auth][client]", {
          source,
          pathname,
          userId: user?.id ?? null,
          email: user?.email ?? null,
        });
      }
    };

    void logCurrentUser("page-load");

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") &&
        session
      ) {
        const cacheKey = buildSessionCacheKey(session);
        if (!invalidSessionRef.current && lastLoggedSessionRef.current !== cacheKey) {
          lastLoggedSessionRef.current = cacheKey;
          void upsertSessionLog(supabase, session).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown session logging error";
            if (isExpectedInvalidSessionError(message)) {
              invalidSessionRef.current = true;
              if (logEnabled) {
                console.info("[auth][session]", { event, pathname, message, handled: true });
              }
              return;
            }
            if (logEnabled) {
              // Avoid Next.js dev error overlay for non-fatal logging failures.
              console.warn("[auth][session]", { event, pathname, message, handled: true });
            }
          });
        }
      }

      if (event === "SIGNED_OUT") {
        lastLoggedSessionRef.current = null;
        invalidSessionRef.current = false;
      }

      void (async () => {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (logEnabled && error) {
          console.info("[auth][client]", {
            source: "auth-state-change",
            event,
            pathname,
            sessionUserId: session?.user?.id ?? null,
            error: error.message,
          });
          return;
        }

        if (logEnabled) {
          console.info("[auth][client]", {
            source: "auth-state-change",
            event,
            pathname,
            sessionUserId: session?.user?.id ?? null,
            sessionEmail: session?.user?.email ?? null,
            validatedUserId: user?.id ?? null,
            validatedEmail: user?.email ?? null,
            mismatch: (session?.user?.id ?? null) !== (user?.id ?? null),
          });
        }
      })();
    });

    return () => data.subscription.unsubscribe();
  }, [pathname]);

  return null;
}
