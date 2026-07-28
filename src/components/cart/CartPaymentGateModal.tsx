"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
import { KYC_REQUIRED_FOR_BORROW } from "@/lib/kyc/kyc-policy";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { e164ToFrenchNationalDigits, frenchLocalToE164, normalizeFrenchLocalNumber } from "@/lib/phone/fr-mobile";
import { isMultiAccountPhoneException } from "@/lib/phone/multi-account-phone-exception";
import { resolveVerifiedPhoneE164 } from "@/lib/phone/phone-verified";
import { verifyPhoneChangeOtp } from "@/lib/phone/verify-phone-change-otp";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const PROFILE_COMPLETE_HREF = "/profile/complete?tab=me";
const KYC_HREF = "/profile/kyc?tab=me";

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

type CartPaymentGateModalProps = {
  open: boolean;
  onClose: () => void;
  profileComplete: boolean;
  kycVerified: boolean;
  phoneReady: boolean;
  /** Appelé après confirmation OTP réussie (ex. refresh panier). */
  onPhoneVerified?: () => void;
};

export function CartPaymentGateModal({
  open,
  onClose,
  profileComplete,
  kycVerified,
  phoneReady,
  onPhoneVerified,
}: CartPaymentGateModalProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);

  const needsProfile = !profileComplete;
  const needsPhone = !phoneReady;
  const needsKyc = KYC_REQUIRED_FOR_BORROW && !kycVerified;

  const [phoneStep, setPhoneStep] = useState<"intro" | "otp">("intro");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [pendingE164, setPendingE164] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);

  const resetPhoneUi = useCallback(() => {
    setPhoneStep("intro");
    setPhoneLocal("");
    setPendingE164(null);
    setOtpCode("");
    setBusy(false);
    setError(null);
    setStatus(null);
    setEditingPhone(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetPhoneUi();
      return;
    }
    if (!needsPhone) return;

    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: usersRow } = await supabase.from("users").select("phone").eq("id", user.id).maybeSingle();
      const { data: profileRow } = await supabase
        .from("user_profiles")
        .select("profile_data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const profileData = ((profileRow?.profile_data ?? {}) as Record<string, unknown>) ?? {};
      const profilePhone = typeof profileData.phone_e164 === "string" ? profileData.phone_e164 : "";
      const publicPhone = typeof usersRow?.phone === "string" ? usersRow.phone : "";
      const verified =
        resolveVerifiedPhoneE164({
          usersPhone: publicPhone,
          profilePhoneE164: profilePhone,
          phoneCodeVerified: profileData.phone_code_verified === true,
          authPhone: typeof user.phone === "string" ? user.phone : null,
          phoneConfirmedAt: user.phone_confirmed_at ?? null,
        }) ?? "";
      const draft = verified || tryNormalizePhoneToE164(profilePhone) || "";
      setPhoneLocal(draft ? e164ToFrenchNationalDigits(draft) : "");
      setEditingPhone(!draft);
    })();

    return () => {
      cancelled = true;
    };
  }, [needsPhone, open, resetPhoneUi, supabase]);

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

    setPendingE164(nextE164);
    setPhoneStep("otp");
    setEditingPhone(false);
    setOtpCode("");
    setStatus("Code envoyé par SMS.");
    return true;
  };

  const startPhoneConfirm = async () => {
    setError(null);
    setStatus(null);
    const national = normalizeFrenchLocalNumber(phoneLocal);
    if (national.length !== 9) {
      setEditingPhone(true);
      setError("Indique un numéro mobile français à 9 chiffres (sans l’indicatif +33).");
      setPhoneStep("otp");
      return;
    }
    const nextE164 = frenchLocalToE164(phoneLocal);
    if (!nextE164) {
      setError("Numéro invalide.");
      return;
    }

    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session invalide.");
        return;
      }
      await sendPhoneOtp(nextE164, user.id);
    } finally {
      setBusy(false);
    }
  };

  const submitPhoneOtp = async () => {
    if (!pendingE164) return;
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setError("Indique un code à 6 chiffres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyPhoneChangeOtp(supabase, pendingE164, code);
      if (!verified.ok) {
        setError(verified.message);
        setOtpCode("");
        return;
      }

      const { error: phoneError } = await supabase.rpc("set_user_phone_verified", {
        p_phone_e164: pendingE164,
        p_request_id: crypto.randomUUID(),
      });
      if (phoneError) {
        setError(phoneError.message);
        return;
      }

      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            phone_e164: pendingE164,
            phone_code_verified: true,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (profileError) {
        setError(profileError.message);
        return;
      }

      onClose();
      onPhoneVerified?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const resendPhoneOtp = async () => {
    if (!pendingE164) return;
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session invalide.");
        return;
      }
      await sendPhoneOtp(pendingE164, user.id);
    } finally {
      setBusy(false);
    }
  };

  // ——— Contenu hors flux OTP téléphone ———
  let body: string;
  let primaryHref: string | null = null;
  let primaryLabel: string;

  if (needsProfile) {
    body =
      needsKyc
        ? "Pour payer ta commande, renseigne tes infos essentielles (prénom, âge, ville, tailles), ajoute un numéro de téléphone et valide ton identité (KYC)."
        : needsPhone
          ? "Pour payer ta commande, renseigne tes infos essentielles (prénom, âge, ville, tailles) et confirme ton numéro de téléphone mobile."
          : "Pour payer ta commande, renseigne tes infos essentielles (prénom, âge, ville, tailles). Pas besoin d’atteindre 100 %.";
    primaryHref = PROFILE_COMPLETE_HREF;
    primaryLabel = "Compléter mon profil";
  } else if (needsPhone) {
    body = "Pour réserver et payer ta commande, confirme ton numéro de téléphone mobile par SMS.";
    primaryHref = null;
    primaryLabel = "Confirmer mon numéro";
  } else {
    body = "Pour payer ta commande, valide d’abord ton identité (KYC).";
    primaryHref = KYC_HREF;
    primaryLabel = "Faire ma vérification";
  }

  const showInlinePhone = needsPhone && (!needsProfile || phoneStep === "otp");
  const expandedOtp = phoneStep === "otp";

  return (
    <SegnaAppBottomSheet
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      dialogId="cart-payment-gate-modal"
      labelledBy="cart-payment-gate-modal-title"
      zIndexClassName="z-[100]"
      className={cn(
        "transition-[max-height] duration-300 ease-out",
        expandedOtp ? "max-h-[92dvh]" : undefined,
      )}
    >
      <SegnaDialogSheetHandle />
      <h2 id="cart-payment-gate-modal-title" className={segnaDialogTitleClass()}>
        {expandedOtp ? "Confirme ton numéro" : "Paiement indisponible"}
      </h2>

      {!expandedOtp ? <p className={cn(segnaDialogBodyClass(), "mt-3")}>{body}</p> : null}

      {expandedOtp ? (
        <div className="mt-4 space-y-4">
          <p className={segnaDialogBodyClass()}>
            Saisis le code à 6 chiffres envoyé par SMS. Le numéro n’est enregistré qu’après confirmation.
          </p>

          {editingPhone || !pendingE164 ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[16px] font-semibold text-zinc-600">+33</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="612345678"
                value={phoneLocal}
                disabled={busy}
                onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 9))}
                className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[16px] text-zinc-900 outline-none ring-zinc-900 focus-visible:ring-2"
              />
            </div>
          ) : (
            <p className="text-[15px] font-medium text-zinc-900">
              {formatPhoneDisplay(pendingE164)}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditingPhone(true);
                  setError(null);
                }}
                className="text-[14px] font-semibold text-zinc-600 underline underline-offset-2"
              >
                Modifier
              </button>
            </p>
          )}

          {!editingPhone && pendingE164 ? (
            <OtpInput compact value={otpCode} onChange={setOtpCode} length={6} />
          ) : null}

          {status && !error ? <p className="text-[13px] text-zinc-600">{status}</p> : null}
          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}

          <div className="flex flex-col gap-2 pt-1">
            {editingPhone || !pendingE164 ? (
              <button
                type="button"
                disabled={busy || normalizeFrenchLocalNumber(phoneLocal).length !== 9}
                onClick={() => void startPhoneConfirm()}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-45"
              >
                {busy ? "Envoi…" : "Envoyer le code"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || otpCode.replace(/\D/g, "").length !== 6}
                  onClick={() => void submitPhoneOtp()}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-45"
                >
                  {busy ? "Vérification…" : "Valider"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resendPhoneOtp()}
                  className="flex h-11 w-full items-center justify-center text-[14px] font-semibold text-zinc-700 underline disabled:opacity-50"
                >
                  Renvoyer le code
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPhoneStep("intro");
                setError(null);
                setStatus(null);
                setOtpCode("");
              }}
              className="flex h-11 w-full items-center justify-center text-[14px] font-semibold text-zinc-500"
            >
              Retour
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {primaryHref ? (
            <Link
              href={primaryHref}
              onClick={onClose}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
            >
              {primaryLabel}
            </Link>
          ) : showInlinePhone ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPhoneConfirm()}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-45"
            >
              {busy ? "Envoi…" : primaryLabel}
            </button>
          ) : null}

          {needsProfile && needsPhone ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPhoneConfirm()}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-45"
            >
              Confirmer mon numéro
            </button>
          ) : null}

          {needsProfile && needsKyc ? (
            <Link
              href={KYC_HREF}
              onClick={onClose}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50"
            >
              Faire ma vérification
            </Link>
          ) : null}

          {error && showInlinePhone ? <p className="text-center text-[13px] text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-full items-center justify-center text-[14px] font-semibold text-zinc-500"
          >
            Plus tard
          </button>
        </div>
      )}
    </SegnaAppBottomSheet>
  );
}
