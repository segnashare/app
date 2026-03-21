"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { revokeSessionLog } from "@/lib/supabase/userSessions";

export function SettingsSignOutButton() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await revokeSessionLog(supabase, session).catch(() => undefined);
      await supabase.auth.signOut();

      // Purge app-scoped caches so a next user does not see stale data.
      if (typeof window !== "undefined") {
        for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = window.sessionStorage.key(index);
          if (key?.startsWith("segna:")) window.sessionStorage.removeItem(key);
        }
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith("segna:")) window.localStorage.removeItem(key);
        }
      }

      router.replace("/auth/sign-in");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 text-base font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isSigningOut ? "Deconnexion..." : "Se deconnecter"}
    </button>
  );
}
