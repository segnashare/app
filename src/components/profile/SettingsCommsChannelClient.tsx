"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_MEMBER_COMMS_PREFERENCES,
  loadMemberCommsPreferences,
  saveMemberCommsPreferences,
  type MemberCommsPreferences,
} from "@/lib/notifications/member-comms-preferences";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type Channel = "email" | "sms";

type Props = {
  channel: Channel;
  returnPath: string;
};

function ToggleRow({
  title,
  subtitle,
  checked,
  disabled,
  busy,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[52px] w-full items-start gap-3 border-b border-zinc-100 px-5 py-3.5 pr-4 text-left last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug text-zinc-900">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">{subtitle}</p>
      </div>
      <label className={cn("flex shrink-0 items-center pt-0.5", disabled ? "cursor-default opacity-55" : "cursor-pointer")}>
        <span className="sr-only">{title}</span>
        <input
          type="checkbox"
          className="h-6 w-6 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-400 focus:ring-offset-0 disabled:opacity-50"
          checked={checked}
          disabled={disabled || busy}
          onChange={(e) => onChange?.(e.target.checked)}
        />
      </label>
    </div>
  );
}

export function SettingsCommsChannelClient({ channel, returnPath }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<MemberCommsPreferences>(DEFAULT_MEMBER_COMMS_PREFERENCES);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setLoading(false);
          setError("Session invalide.");
        }
        return;
      }
      const next = await loadMemberCommsPreferences(supabase, user.id);
      if (!cancelled) {
        setPrefs(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const marketingOn = channel === "email" ? prefs.emailMarketing : prefs.smsMarketing;

  const commitMarketing = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const prev = prefs;
      const updated: MemberCommsPreferences =
        channel === "email" ? { ...prefs, emailMarketing: next } : { ...prefs, smsMarketing: next };
      setPrefs(updated);
      const result = await saveMemberCommsPreferences(supabase, updated);
      if (!result.ok) {
        setPrefs(prev);
        setError(result.message);
      }
      setBusy(false);
    },
    [busy, channel, prefs, supabase],
  );

  const title = channel === "email" ? "E-mail" : "SMS";
  const intro =
    channel === "email"
      ? "Choisis quels e-mails Segna tu veux recevoir. Les messages liés à tes commandes et à ton compte restent toujours actifs."
      : "Choisis quels SMS Segna tu veux recevoir. Les SMS liés à tes commandes, livraisons et délais restent toujours actifs.";

  return (
    <main className={cn(montserrat.className, "min-h-[100dvh] bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <Link href={returnPath} className="text-[18px] font-semibold text-zinc-900">
          Retour
        </Link>
        <h1 className="text-center text-[20px] font-bold leading-tight text-zinc-900">{title}</h1>
        <span className="w-[4.5rem]" aria-hidden />
      </header>

      <section className="mx-auto w-full max-w-[460px] pb-10 pt-5">
        <p className="px-5 text-[14px] leading-relaxed text-zinc-600">{intro}</p>

        {loading ? (
          <p className="mt-6 px-5 text-sm text-zinc-500">Chargement…</p>
        ) : (
          <div className="mt-5 border-t border-zinc-100">
            <ToggleRow
              title={channel === "email" ? "E-mails de commande & compte" : "SMS de commande & compte"}
              subtitle={
                channel === "email"
                  ? "Paiements, livraisons, retours, abonnement — toujours envoyés."
                  : "Préparation, suivi, retours, échéances — toujours envoyés."
              }
              checked
              disabled
            />
            <ToggleRow
              title={channel === "email" ? "Offres & actus par e-mail" : "Offres & actus par SMS"}
              subtitle="Rappels d’engagement, panier abandonné, nouveautés et promotions. Désactive pour éviter le marketing."
              checked={marketingOn}
              busy={busy}
              onChange={(next) => void commitMarketing(next)}
            />
          </div>
        )}

        {error ? <p className="mt-4 px-5 text-[13px] text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
