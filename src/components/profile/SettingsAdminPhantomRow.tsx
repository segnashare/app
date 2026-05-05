"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type SettingsAdminPhantomRowProps = {
  initialEnabled: boolean;
};

export function SettingsAdminPhantomRow({ initialEnabled }: SettingsAdminPhantomRowProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const commit = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const prev = enabled;
      setEnabled(next);
      const { error: rpcError } = await supabase.rpc("set_admin_phantom_mode", { p_enabled: next });
      if (rpcError) {
        setEnabled(prev);
        setError(rpcError.message ?? "Impossible d’enregistrer le réglage.");
      }
      setBusy(false);
    },
    [busy, enabled, supabase],
  );

  return (
    <div className="flex min-h-[52px] w-full items-start gap-3 px-5 py-3.5 pr-4 text-left">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug text-zinc-900">Mode Phantom</p>
        <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">
          Invisible pour les autres membres : pas dans le fil d&apos;accueil ni le catalogue shop, fiche profil
          inaccessible. Ton compte reste utilisable pour toi.
        </p>
        {error ? <p className="mt-2 text-[13px] text-red-600">{error}</p> : null}
      </div>
      <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
        <span className="sr-only">Activer le mode Phantom</span>
        <input
          type="checkbox"
          className={cn(
            "h-6 w-6 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-400 focus:ring-offset-0 disabled:opacity-50",
          )}
          checked={enabled}
          disabled={busy}
          onChange={(event) => void commit(event.target.checked)}
        />
      </label>
    </div>
  );
}
