import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getCurrentAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { user, error };
});

export type ReferralInviteIntroKind = "none" | "pending" | "qualified";

export type CurrentUserAppState = {
  onboarding_process: string | null;
  onboarding_mode: "demo" | "bridge" | "real";
  /** L’utilisatrice figure comme filleul qualifié dans `referrals` (crédits parrainage déjà appliqués). */
  referredViaQualifiedInvite: boolean;
  /** Bannière intro parrainage : `pending` = code capturé, avant fin onboarding / crédits ; `qualified` = filleul actif. */
  referralInviteForIntro: ReferralInviteIntroKind;
  /** Modale « bonus parrain » : présent si quelqu’un s’est inscrit avec son code et les crédits ont été crédités. */
  referrerBonusModal: { referredDisplayName: string; points: number } | null;
};

export const getCurrentUserAppState = cache(async (userId: string): Promise<CurrentUserAppState> => {
  const supabase = await createSupabaseServerClient();

  const [userRes, referralRes] = await Promise.all([
    supabase.from("users").select("onboarding_process,onboarding_mode,referrer_bonus_modal,pending_referral_code").eq("id", userId).maybeSingle(),
    supabase.from("referrals").select("id").eq("referred_user_id", userId).limit(1).maybeSingle(),
  ]);

  if (userRes.error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[user-app-state]", userRes.error.message);
    }
    return {
      onboarding_process: null,
      onboarding_mode: "real",
      referredViaQualifiedInvite: false,
      referralInviteForIntro: "none",
      referrerBonusModal: null,
    };
  }

  if (referralRes.error && process.env.NODE_ENV === "development") {
    console.warn("[user-app-state] referrals", referralRes.error.message);
  }

  const modeRaw = userRes.data?.onboarding_mode;
  const onboarding_mode: CurrentUserAppState["onboarding_mode"] =
    modeRaw === "demo" || modeRaw === "bridge" || modeRaw === "real" ? modeRaw : "real";

  let referrerBonusModal: CurrentUserAppState["referrerBonusModal"] = null;
  const rawModal = userRes.data?.referrer_bonus_modal as Record<string, unknown> | null | undefined;
  if (rawModal && typeof rawModal === "object") {
    const referredDisplayName =
      typeof rawModal.referred_display_name === "string" ? rawModal.referred_display_name.trim() : "";
    const pointsRaw = rawModal.points;
    const points =
      typeof pointsRaw === "number" && Number.isFinite(pointsRaw)
        ? pointsRaw
        : typeof pointsRaw === "string"
          ? Number(pointsRaw)
          : NaN;
    if (referredDisplayName && Number.isFinite(points) && points > 0) {
      referrerBonusModal = { referredDisplayName, points: Math.floor(points) };
    }
  }

  const referredQualified = Boolean(!referralRes.error && referralRes.data);
  const pendingRaw = userRes.data?.pending_referral_code;
  const hasPendingCode = typeof pendingRaw === "string" && pendingRaw.trim().length > 0;

  let referralInviteForIntro: ReferralInviteIntroKind = "none";
  if (referredQualified) referralInviteForIntro = "qualified";
  else if (hasPendingCode) referralInviteForIntro = "pending";

  return {
    onboarding_process: userRes.data?.onboarding_process ?? null,
    onboarding_mode,
    referredViaQualifiedInvite: referredQualified,
    referralInviteForIntro,
    referrerBonusModal,
  };
});
