"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { e164ToFrenchNationalDigits, frenchLocalToE164, normalizeFrenchLocalNumber } from "@/lib/phone/fr-mobile";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

function formatPhoneDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("33") && d.length >= 11) {
    const national = d.slice(2);
    if (national.length === 9) return `+33 0${national}`;
    return `+33 ${national}`;
  }
  return e164.trim() || "";
}

export function ProfileEditContactClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const returnPath = searchParams.get("returnPath") ?? "/profile/complete?tab=me";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [initialEmail, setInitialEmail] = useState("");
  const [initialE164, setInitialE164] = useState("");
  const [email, setEmail] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
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
      const em = typeof user.email === "string" ? user.email : "";
      if (cancelled) return;
      setInitialEmail(em);
      setEmail(em);

      const { data: usersRow } = await supabase.from("users").select("phone").eq("id", user.id).maybeSingle();
      const { data: profileRow } = await supabase.from("user_profiles").select("profile_data").eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      const profileData = ((profileRow?.profile_data ?? {}) as Record<string, unknown>) ?? {};
      const profilePhone = typeof profileData.phone_e164 === "string" ? profileData.phone_e164 : "";
      const publicPhone = typeof usersRow?.phone === "string" ? usersRow.phone : "";
      const authPhone = typeof user.phone === "string" ? user.phone : "";
      const resolved = authPhone || publicPhone || profilePhone;
      setInitialE164(resolved);
      setPhoneLocal(resolved ? e164ToFrenchNationalDigits(resolved) : "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const onSave = async () => {
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim().toLowerCase();
    const national = normalizeFrenchLocalNumber(phoneLocal);
    if (national.length > 0 && national.length !== 9) {
      setError("Indique un numéro mobile français à 9 chiffres (sans l’indicatif +33).");
      return;
    }
    const nextE164 = national.length === 9 ? frenchLocalToE164(phoneLocal) : "";

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session invalide.");
        return;
      }

      if (trimmedEmail !== initialEmail.toLowerCase()) {
        const { data: emailOk, error: emailAvailErr } = await supabase.rpc("email_available_for_user_change", {
          p_email: trimmedEmail,
          p_user_id: user.id,
        });
        if (emailAvailErr) {
          setError(emailAvailErr.message ?? "Impossible de vérifier l’e-mail.");
          return;
        }
        if (emailOk !== true) {
          setError("Cette adresse e-mail est déjà utilisée par un autre compte.");
          return;
        }
        const { error: emailErr } = await supabase.auth.updateUser({ email: trimmedEmail });
        if (emailErr) {
          setError(emailErr.message);
          return;
        }
        const { error: usersEmailErr } = await supabase.from("users").update({ email: trimmedEmail }).eq("id", user.id);
        if (usersEmailErr) {
          setError(usersEmailErr.message);
          return;
        }
        setInfo("Si la nouvelle adresse est acceptée, un e-mail de confirmation peut t’être envoyé : vérifie ta boîte.");
      }

      if (nextE164 !== initialE164) {
        if (!nextE164) {
          setError("Pour retirer le téléphone, contacte le support pour l’instant.");
          return;
        }
        const { data: phoneOk, error: phoneAvailErr } = await supabase.rpc("phone_available_for_user_change", {
          p_phone: nextE164,
          p_user_id: user.id,
        });
        if (phoneAvailErr) {
          setError(phoneAvailErr.message ?? "Impossible de vérifier le numéro.");
          return;
        }
        if (phoneOk !== true) {
          setError("Ce numéro de téléphone est déjà utilisé par un autre compte.");
          return;
        }
        const { error: rpcErr } = await supabase.rpc("update_user_profile_public", {
          p_profile_json: {
            profile_data: {
              phone_e164: nextE164,
            },
          },
          p_request_id: crypto.randomUUID(),
        });
        if (rpcErr) {
          setError(rpcErr.message);
          return;
        }
        const { error: usersPhoneErr } = await supabase.from("users").update({ phone: nextE164 }).eq("id", user.id);
        if (usersPhoneErr) {
          setError(usersPhoneErr.message);
          return;
        }
        const { error: authPhoneErr } = await supabase.auth.updateUser({ phone: nextE164 });
        if (authPhoneErr) {
          // Téléphone enregistré côté profil / users même si l’auth SMS n’est pas activée sur le projet.
          setInfo((prev) =>
            [prev, "Téléphone enregistré sur ton compte. La vérification SMS dépend des réglages Segna."].filter(Boolean).join(" "),
          );
        }
      }

      router.push(returnPath);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={cn(montserrat.className, "min-h-[100dvh] bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <Link href={returnPath} className="text-[18px] font-semibold text-zinc-900">
          Annuler
        </Link>
        <h1 className="text-center text-[20px] font-bold leading-tight text-zinc-900">Téléphone & e-mail</h1>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void onSave()}
          className="text-[18px] font-semibold text-zinc-900 disabled:opacity-40"
        >
          {saving ? "…" : "Terminé"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] space-y-6 px-5 pb-10 pt-6">
        {loading ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="edit-contact-email" className="text-[15px] font-semibold text-zinc-900">
                E-mail
              </label>
              <input
                id="edit-contact-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[16px] text-zinc-900 outline-none ring-zinc-900 focus-visible:ring-2"
              />
              <p className="text-[13px] leading-relaxed text-zinc-500">
                La vérification de ton adresse e-mail nous aide à sécuriser ton compte. Après modification, pense à confirmer le message
                éventuellement envoyé par Segna.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-contact-phone" className="text-[15px] font-semibold text-zinc-900">
                Téléphone mobile (France)
              </label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[16px] font-semibold text-zinc-600">+33</span>
                <input
                  id="edit-contact-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="612345678"
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(e.target.value)}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[16px] text-zinc-900 outline-none ring-zinc-900 focus-visible:ring-2"
                />
              </div>
              {initialE164 ? (
                <p className="text-[12px] text-zinc-500">Actuellement : {formatPhoneDisplay(initialE164)}</p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-[#E44D3E]">{error}</p> : null}
            {info ? <p className="text-sm text-zinc-600">{info}</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
