"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { isMultiAccountPhoneException } from "@/lib/phone/multi-account-phone-exception";
import { resolveVerifiedPhoneE164 } from "@/lib/phone/phone-verified";
import { verifyPhoneChangeOtp } from "@/lib/phone/verify-phone-change-otp";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const PRIVACY_HREF = "https://www.segnashare.com/politique-confidentialite";

const ACTION_TEXT = "text-[15px] font-semibold text-zinc-800 transition hover:text-zinc-950";

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

function VerifiedBadge() {
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900"
      aria-label="Vérifié"
      title="Vérifié"
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden />
    </span>
  );
}

export function SettingsContactSection() {
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);

  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [verifiedE164, setVerifiedE164] = useState("");
  const [pendingE164, setPendingE164] = useState("");
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  const [email, setEmail] = useState("");

  const [modalKind, setModalKind] = useState<"email" | "phone" | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otpPhoneE164, setOtpPhoneE164] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpHint, setOtpHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError("Connecte-toi pour voir tes coordonnées.");
      return;
    }
    setUserId(user.id);
    const em = typeof user.email === "string" ? user.email : "";
    setInitialEmail(em);
    setEmail(em);
    setEmailConfirmed(!!user.email_confirmed_at);

    const { data: usersRow } = await supabase.from("users").select("phone").eq("id", user.id).maybeSingle();
    const { data: profileRow } = await supabase.from("user_profiles").select("profile_data").eq("user_id", user.id).maybeSingle();
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
    const pending = !verified ? tryNormalizePhoneToE164(profilePhone) ?? "" : "";
    setVerifiedE164(verified);
    setPendingE164(pending);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const phoneConfirmed = Boolean(verifiedE164);
  const phoneDisplay = verifiedE164
    ? formatPhoneDisplay(verifiedE164)
    : pendingE164
      ? formatPhoneDisplay(pendingE164)
      : "—";

  const closeModal = () => {
    setModalKind(null);
    setPendingEmail(null);
    setOtpPhoneE164(null);
    setOtpCode("");
    setOtpHint(null);
    setOtpBusy(false);
  };

  const syncEmailAfterOtp = async (uid: string, nextEmail: string) => {
    const { error: usersEmailErr } = await supabase.from("users").update({ email: nextEmail }).eq("id", uid);
    if (usersEmailErr) throw new Error(usersEmailErr.message);
    const {
      data: { user: u2 },
    } = await supabase.auth.getUser();
    if (u2 && u2.email?.toLowerCase() !== nextEmail.toLowerCase()) {
      const { error: emailErr } = await supabase.auth.updateUser({ email: nextEmail });
      if (emailErr) throw new Error(emailErr.message);
    }
  };

  const startEmailVerification = async (nextEmailTrim: string) => {
    setError(null);
    setInfo(null);
    setOtpCode("");
    setOtpHint(null);

    const { error: sendErr } = await supabase.auth.signInWithOtp({
      email: nextEmailTrim,
      options: { shouldCreateUser: false },
    });
    if (sendErr) {
      setError(
        `Impossible d’envoyer un code à cette adresse (${sendErr.message}). Vérifie que l’e-mail est valide, ou réessaie dans quelques instants.`,
      );
      return;
    }
    setPendingEmail(nextEmailTrim);
    setModalKind("email");
    setOtpHint("Un code à 6 chiffres t’a été envoyé par e-mail.");
  };

  const startPhoneVerification = async (phoneE164: string) => {
    if (!userId) {
      setError("Session invalide.");
      return;
    }
    setError(null);
    setInfo(null);
    setOtpCode("");
    setOtpHint(null);
    setOtpBusy(true);
    try {
      const { data: phoneOk, error: phoneAvailErr } = await supabase.rpc("phone_available_for_user_change", {
        p_phone: phoneE164,
        p_user_id: userId,
      });
      if (phoneAvailErr) {
        setError(phoneAvailErr.message ?? "Impossible de vérifier le numéro.");
        return;
      }
      if (phoneOk !== true && !isMultiAccountPhoneException(phoneE164)) {
        setError("Ce numéro de téléphone est déjà utilisé par un autre compte.");
        return;
      }

      const { error: authPhoneErr } = await supabase.auth.updateUser({ phone: phoneE164 });
      if (authPhoneErr) {
        setError(mapPhoneProviderError(authPhoneErr.message));
        return;
      }

      setOtpPhoneE164(phoneE164);
      setModalKind("phone");
      setOtpHint("Un code à 6 chiffres t’a été envoyé par SMS.");
    } finally {
      setOtpBusy(false);
    }
  };

  const onTerminéEdit = async () => {
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Indique une adresse e-mail valide.");
      return;
    }

    if (trimmedEmail === initialEmail.toLowerCase()) {
      setEditMode(false);
      return;
    }

    if (!userId) {
      setError("Session invalide.");
      return;
    }

    const { data: emailOk, error: emailRpcErr } = await supabase.rpc("email_available_for_user_change", {
      p_email: trimmedEmail,
      p_user_id: userId,
    });
    if (emailRpcErr) {
      setError(emailRpcErr.message ?? "Impossible de vérifier l’e-mail.");
      return;
    }
    if (emailOk !== true) {
      setError("Cette adresse e-mail est déjà utilisée par un autre compte.");
      return;
    }

    await startEmailVerification(trimmedEmail);
  };

  const submitEmailOtp = async () => {
    if (!userId || !pendingEmail) return;
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setError("Indique un code à 6 chiffres.");
      return;
    }

    setOtpBusy(true);
    setError(null);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token: code,
        type: "email",
      });
      if (vErr) {
        setError(vErr.message ?? "Code incorrect ou expiré.");
        return;
      }
      await syncEmailAfterOtp(userId, pendingEmail);
      closeModal();
      setEditMode(false);
      setInitialEmail(pendingEmail);
      setEmail(pendingEmail);
      setInfo("Adresse e-mail mise à jour.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setOtpBusy(false);
    }
  };

  const submitPhoneOtp = async () => {
    if (!otpPhoneE164) return;
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setError("Indique un code à 6 chiffres.");
      return;
    }

    setOtpBusy(true);
    setError(null);
    try {
      const verified = await verifyPhoneChangeOtp(supabase, otpPhoneE164, code);
      if (!verified.ok) {
        setError(verified.message);
        setOtpCode("");
        return;
      }

      const { error: phoneError } = await supabase.rpc("set_user_phone_verified", {
        p_phone_e164: otpPhoneE164,
        p_request_id: crypto.randomUUID(),
      });
      if (phoneError) {
        setError(phoneError.message);
        return;
      }

      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            phone_e164: otpPhoneE164,
            phone_code_verified: true,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (profileError) {
        setError(profileError.message);
        return;
      }

      closeModal();
      setInfo("Numéro de téléphone confirmé.");
      await load();
    } finally {
      setOtpBusy(false);
    }
  };

  const resendEmailOtp = async () => {
    if (!pendingEmail) return;
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: pendingEmail,
      options: { shouldCreateUser: false },
    });
    if (error) {
      setError(error.message ?? "Impossible de renvoyer le code.");
      return;
    }
    setInfo("Nouveau code envoyé.");
  };

  const resendPhoneOtp = async () => {
    if (!otpPhoneE164) return;
    await startPhoneVerification(otpPhoneE164);
  };

  if (loading) {
    return (
      <div className="px-5 py-4">
        <p className="text-[14px] text-zinc-500">Chargement…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="px-5 py-4">
        <p className="text-[14px] text-red-600">{error ?? "Connecte-toi pour gérer tes coordonnées."}</p>
      </div>
    );
  }

  const phoneRow = (
    <div className="inline-flex min-w-0 max-w-full items-center gap-2">
      {pendingE164 && !phoneConfirmed ? (
        <button
          type="button"
          disabled={otpBusy}
          onClick={() => void startPhoneVerification(pendingE164)}
          className="inline-flex min-w-0 max-w-full items-baseline gap-1.5 text-left transition hover:opacity-80 disabled:opacity-50"
          aria-label={`Confirmer le numéro ${phoneDisplay}`}
        >
          <span className="text-[16px] font-medium leading-snug text-zinc-900">{phoneDisplay}</span>
          <span className="shrink-0 text-[13px] font-medium leading-snug text-zinc-500">(pas confirmé)</span>
        </button>
      ) : (
        <>
          <span className="text-[16px] font-medium leading-snug text-zinc-900">{phoneDisplay}</span>
          {phoneConfirmed ? <VerifiedBadge /> : null}
        </>
      )}
    </div>
  );

  return (
    <>
      {!editMode ? (
        <>
          {info ? (
            <div className="border-b border-zinc-100 px-5 py-3">
              <p className="text-[13px] leading-snug text-zinc-600">{info}</p>
            </div>
          ) : null}
          {error && !modalKind ? (
            <div className="border-b border-zinc-100 px-5 py-3">
              <p className="text-[13px] leading-snug text-red-600">{error}</p>
            </div>
          ) : null}
          <div className="flex min-h-[52px] items-center px-5 py-3.5">{phoneRow}</div>
          <div className="flex min-h-[52px] w-full items-center gap-2 px-5 py-3.5">
            <div className="inline-flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-[16px] font-medium leading-snug text-zinc-900">{initialEmail || "—"}</span>
              {emailConfirmed && initialEmail ? <VerifiedBadge /> : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setEmail(initialEmail);
                setEditMode(true);
              }}
              className={cn(ACTION_TEXT, "shrink-0")}
            >
              Modifier
            </button>
          </div>
        </>
      ) : (
        <div className="px-5 py-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setEmail(initialEmail);
                setError(null);
                setInfo(null);
              }}
              className={cn(ACTION_TEXT, "text-zinc-600 hover:text-zinc-900")}
            >
              Annuler
            </button>
          </div>

          <div className="border-b border-zinc-100 py-3">{phoneRow}</div>

          <div className="pt-4">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <label htmlFor="settings-contact-email" className="sr-only">
                  E-mail
                </label>
                <input
                  id="settings-contact-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-w-0 border-0 border-b border-zinc-300 bg-transparent pb-1.5 text-[16px] font-medium leading-snug text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-900"
                  placeholder="adresse@e-mail.com"
                />
              </div>
              <button type="button" onClick={() => void onTerminéEdit()} className={cn(ACTION_TEXT, "shrink-0 pb-1.5")}>
                Terminé
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-zinc-500">
              La vérification de ton adresse e-mail nous aide à sécuriser ton compte.{" "}
              <a href={PRIVACY_HREF} target="_blank" rel="noopener noreferrer" className="font-semibold text-zinc-700 underline underline-offset-2">
                En savoir plus
              </a>
            </p>
          </div>

          {error ? <p className="mt-3 text-[13px] text-red-600">{error}</p> : null}
          {info ? <p className="mt-3 text-[13px] text-zinc-600">{info}</p> : null}
        </div>
      )}

      {modalKind ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!otpBusy) closeModal();
          }}
        >
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-otp-title"
            onClick={(e) => e.stopPropagation()}
          >
            <SegnaDialogDismissButton variant="overlay" onClick={() => !otpBusy && closeModal()} />
            <h2 id="settings-otp-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
              {modalKind === "phone" ? "Code SMS" : "Code e-mail"}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              {modalKind === "phone"
                ? `Saisis le code à 6 chiffres envoyé au ${otpPhoneE164 ? formatPhoneDisplay(otpPhoneE164) : ""}.`
                : `Saisis le code à 6 chiffres envoyé à ${pendingEmail ?? ""}.`}
            </p>
            {otpHint ? <p className="mt-2 text-[13px] text-zinc-500">{otpHint}</p> : null}

            <div className="mt-5 w-full min-w-0">
              <OtpInput compact value={otpCode} onChange={setOtpCode} length={6} />
            </div>

            {error ? <p className="mt-3 text-center text-[13px] text-red-600">{error}</p> : null}

            <div className="mt-6 flex flex-col gap-2 border-t border-zinc-100 pt-4">
              <button
                type="button"
                disabled={otpBusy}
                onClick={() => void (modalKind === "phone" ? resendPhoneOtp() : resendEmailOtp())}
                className="text-center text-[14px] font-semibold text-zinc-700 underline disabled:opacity-50"
              >
                Renvoyer le code
              </button>
              <button
                type="button"
                disabled={otpBusy || otpCode.replace(/\D/g, "").length !== 6}
                onClick={() => void (modalKind === "phone" ? submitPhoneOtp() : submitEmailOtp())}
                className="mx-auto inline-flex min-h-[48px] w-full max-w-[280px] items-center justify-center rounded-full bg-zinc-900 px-4 text-[16px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-45"
              >
                {otpBusy ? "Vérification…" : "Valider"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
