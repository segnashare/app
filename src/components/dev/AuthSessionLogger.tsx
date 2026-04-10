"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { createSupabaseBrowserClient, isSupabaseAuthLockAbortError } from "@/lib/supabase/client";
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
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (logEnabled && error) {
          console.info("[auth][client]", { source, pathname, error: error.message });
          return;
        }

        if (logEnabled) {
          console.info("[auth][client]", {
            source,
            pathname,
            userId: session?.user?.id ?? null,
            email: session?.user?.email ?? null,
          });
        }
      } catch (e) {
        if (isSupabaseAuthLockAbortError(e)) return;
        const message = e instanceof Error ? e.message : String(e);
        if (logEnabled) {
          console.warn("[auth][client]", { source, pathname, error: message, note: "getSession rejected (often offline)" });
        }
      }
    };

    /** Laisser la page critique (ex. ensureDraft) prendre le verrou GoTrue avant le log dev. */
    const pageLoadLogTimer = window.setTimeout(() => void logCurrentUser("page-load"), 120);

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

      if (logEnabled) {
        console.info("[auth][client]", {
          source: "auth-state-change",
          event,
          pathname,
          userId: session?.user?.id ?? null,
          email: session?.user?.email ?? null,
        });
      }
    });

    return () => {
      window.clearTimeout(pageLoadLogTimer);
      data.subscription.unsubscribe();
    };
  }, [pathname]);

  return null;
}
