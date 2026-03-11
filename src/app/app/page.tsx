"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { revokeSessionLog } from "@/lib/supabase/userSessions";

export default function AppHomePage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await revokeSessionLog(supabase, session).catch(() => undefined);
    await supabase.auth.signOut();
    router.replace("/auth");
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white p-6">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSigningOut ? "Déconnexion..." : "Se déconnecter"}
      </button>
    </main>
  );
}
