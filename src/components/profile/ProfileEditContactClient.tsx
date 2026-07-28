"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import { isMultiAccountPhoneException } from "@/lib/phone/multi-account-phone-exception";
import { e164ToFrenchNationalDigits, frenchLocalToE164, normalizeFrenchLocalNumber } from "@/lib/phone/fr-mobile";
import { resolveVerifiedPhoneE164 } from "@/lib/phone/phone-verified";
import { verifyPhoneChangeOtp } from "@/lib/phone/verify-phone-change-otp";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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

function mapPhoneProviderError(message?: string): string {
  const normalized = (message ?? "").toLowerCase();
  if (normalized.includes("unable to get sms provider")) {
    return "Le fournisseur SMS n'est pas configuré. Active Twilio dans Supabase (Auth > Phone).";
  }
  if (normalized.includes("rate limit")) {
    return "Trop de tentatives. Réessaie dans une minute.";
  }
  if (
    normalized.includes("already been registered") ||
    normalized.includes("already registered") ||
    normalized.includes("phone number has already")
  ) {
    return "Ce numéro de téléphone est déjà utilisé par un autre compte.";
  }
  return message ?? "Impossible d'envoyer le code SMS.";
}

export function ProfileEditContactClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const returnPath = searchParams.get("returnPath") ?? "/profile/complete?tab=me";
  const requirePhone = searchParams.get("requirePhone") === "1";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [initialEmail, setInitialEmail] = useState("");
  const [verifiedE164, setVerifiedE164] = useState("");
  const [email, setEmail] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");

  const [otpStep, setOtpStep] = useState(false);
  const [pendingPhoneE164, setPendingPhoneE164] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");

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
      const verified =
        resolveVerifiedPhoneE164({
          usersPhone: publicPhone,
          profilePhoneE164: profilePhone,
          phoneCodeVerified: profileData.phone_code_verified === true,
          authPhone,
          phoneConfirmedAt: user.phone_confirmed_at ?? null,
        }) ?? "";
      setVerifiedE164(verified);
      // Prefill : numéro validé, sinon brouillon en attente (sans le compter comme enregistré).
      const draft = verified || profilePhone;
      setPhoneLocal(draft ? e164ToFrenchNationalDigits(draft) : "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const sendPhoneOtp = async (nextE164: string, userId: string) => {
    const { data: phoneOk, error: phoneAvailErr } = await supabase.rpc("phone_available_for_user_change", {
      p_phone: nextE164,
      p_user_id: userId,
    });
    if (phoneAvailErr) {
      setError(phoneAvailErr.message ?? "Impossible de vérifier le numéro.");
      return false;
    }
    if (phoneOk !== true && !isMultiAccountPhoneException(nextE164)) {
      setError("Ce numéro de téléphone est déjà utilisé par un autre compte.");
      return false;
    }

    // Brouillon uniquement — unicité / users.phone après OTP.
    const { error: rpcErr } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        profile_data: {
          phone_e164: nextE164,
          phone_code_verified: false,
        },
      },
      p_request_id: crypto.randomUUID(),
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return false;
    }
    await supabase.from("users").update({ phone: null }).eq("id", userId);

    const { error: authPhoneErr } = await supabase.auth.updateUser({ phone: nextE164 });
    if (authPhoneErr) {
      setError(mapPhoneProviderError(authPhoneErr.message));
      return false;
    }

    setPendingPhoneE164(nextE164);
    setOtpCode("");
    setOtpStep(true);
    setInfo("Code envoyé par SMS. Confirme ton numéro pour l’enregistrer.");
    return true;
  };

  const onSave = async () => {
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim().toLowerCase();
    const national = normalizeFrenchLocalNumber(phoneLocal);
    if (requirePhone && national.length === 0) {
      setError("Indique un numéro de téléphone mobile pour continuer.");
      return;
    }
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

      const phoneNeedsVerify = Boolean(nextE164) && nextE164 !== verifiedE164;
      if (!nextE164 && requirePhone) {
        setError("Indique un numéro de téléphone mobile pour continuer.");
        return;
      }
      if (!nextE164 && verifiedE164) {
        setError("Pour retirer le téléphone, contacte le support pour l’instant.");
        return;
      }
      if (phoneNeedsVerify && nextE164) {
        const ok = await sendPhoneOtp(nextE164, user.id);
        if (!ok) return;
        return;
      }

      router.push(returnPath);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const submitPhoneOtp = async () => {
    if (!pendingPhoneE164) return;
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setError("Indique un code à 6 chiffres.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const verified = await verifyPhoneChangeOtp(supabase, pendingPhoneE164, code);
      if (!verified.ok) {
        setError(verified.message);
        setOtpCode("");
        return;
      }

      const { error: phoneError } = await supabase.rpc("set_user_phone_verified", {
        p_phone_e164: pendingPhoneE164,
        p_request_id: crypto.randomUUID(),
      });
      if (phoneError) {
        setError(phoneError.message);
        return;
      }

      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            phone_e164: pendingPhoneE164,
            phone_code_verified: true,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (profileError) {
        setError(profileError.message);
        return;
      }

      router.push(returnPath);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const resendPhoneOtp = async () => {
    if (!pendingPhoneE164) return;
    setError(null);
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session invalide.");
        return;
      }
      await sendPhoneOtp(pendingPhoneE164, user.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={cn(montserrat.className, "min-h-[100dvh] bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <Link
          href={returnPath}
          className="text-[18px] font-semibold text-zinc-900"
          onClick={(e) => {
            if (otpStep) {
              e.preventDefault();
              setOtpStep(false);
              setPendingPhoneE164(null);
              setOtpCode("");
              setInfo(null);
              setError(null);
            }
          }}
        >
          {otpStep ? "Retour" : "Annuler"}
        </Link>
        <h1 className="text-center text-[20px] font-bold leading-tight text-zinc-900">
          {otpStep ? "Confirme ton numéro" : "Téléphone & e-mail"}
        </h1>
        <button
          type="button"
          disabled={saving || loading || (otpStep && otpCode.replace(/\D/g, "").length !== 6)}
          onClick={() => void (otpStep ? submitPhoneOtp() : onSave())}
          className="text-[18px] font-semibold text-zinc-900 disabled:opacity-40"
        >
          {saving ? "…" : otpStep ? "Valider" : "Terminé"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] space-y-6 px-5 pb-10 pt-6">
        {loading ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : otpStep && pendingPhoneE164 ? (
          <>
            <p className="text-[15px] leading-relaxed text-zinc-600">
              Saisis le code à 6 chiffres envoyé au{" "}
              <strong className="text-zinc-900">{formatPhoneDisplay(pendingPhoneE164)}</strong>. Le numéro n’est
              enregistré qu’après cette confirmation.
            </p>
            <OtpInput compact value={otpCode} onChange={setOtpCode} length={6} />
            <button
              type="button"
              disabled={saving}
              onClick={() => void resendPhoneOtp()}
              className="text-[14px] font-semibold text-zinc-700 underline disabled:opacity-50"
            >
              Renvoyer le code
            </button>
            {error ? <p className="text-sm text-[#E44D3E]">{error}</p> : null}
            {info ? <p className="text-sm text-zinc-600">{info}</p> : null}
          </>
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
                La vérification de ton adresse e-mail nous aide à sécuriser ton compte. Après modification, pense à
                confirmer le message éventuellement envoyé par Segna.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="edit-contact-phone" className="text-[15px] font-semibold text-zinc-900">
                Téléphone mobile (France){requirePhone ? " *" : ""}
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
                  required={requirePhone}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[16px] text-zinc-900 outline-none ring-zinc-900 focus-visible:ring-2"
                />
              </div>
              <p className="text-[13px] leading-relaxed text-zinc-500">
                {requirePhone
                  ? "Obligatoire : confirmation par SMS avant réservation ou abonnement."
                  : "Le numéro n’est enregistré qu’après confirmation du code SMS."}
              </p>
              {verifiedE164 ? (
                <p className="text-[12px] text-zinc-500">Actuellement confirmé : {formatPhoneDisplay(verifiedE164)}</p>
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
