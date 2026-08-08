import type { SupabaseClient } from "@supabase/supabase-js";

import { NotificationKind } from "@/lib/notifications/kinds";

/** Préférences canal membre (profil). Les messages transactionnels restent toujours envoyés. */
export type MemberCommsPreferences = {
  emailMarketing: boolean;
  smsMarketing: boolean;
  pushMarketing: boolean;
};

export const DEFAULT_MEMBER_COMMS_PREFERENCES: MemberCommsPreferences = {
  emailMarketing: true,
  smsMarketing: true,
  pushMarketing: true,
};

const PROFILE_KEY = "comms_preferences";

/** Kinds considérés comme marketing / engagement (opt-out possible). */
const MARKETING_NOTIFICATION_KINDS = new Set<string>([
  NotificationKind.onboardingIncompleteReminder,
  NotificationKind.onboardingIncompleteReminderFollowup,
  NotificationKind.abandonedCartReminder,
]);

export function isMarketingNotificationKind(kind: string): boolean {
  // Règles créées depuis le référentiel BO (`rule:{uuid}`).
  if (kind.startsWith("rule:")) return true;
  if (kind === "backoffice_manual_push") return true;
  return MARKETING_NOTIFICATION_KINDS.has(kind);
}

export function parseMemberCommsPreferences(profileData: unknown): MemberCommsPreferences {
  const root =
    profileData && typeof profileData === "object" && !Array.isArray(profileData)
      ? (profileData as Record<string, unknown>)
      : {};
  const raw = root[PROFILE_KEY];
  const prefs =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  return {
    emailMarketing:
      typeof prefs.email_marketing === "boolean"
        ? prefs.email_marketing
        : DEFAULT_MEMBER_COMMS_PREFERENCES.emailMarketing,
    smsMarketing:
      typeof prefs.sms_marketing === "boolean"
        ? prefs.sms_marketing
        : DEFAULT_MEMBER_COMMS_PREFERENCES.smsMarketing,
    pushMarketing:
      typeof prefs.push_marketing === "boolean"
        ? prefs.push_marketing
        : DEFAULT_MEMBER_COMMS_PREFERENCES.pushMarketing,
  };
}

export async function loadMemberCommsPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<MemberCommsPreferences> {
  const { data } = await supabase.from("user_profiles").select("profile_data").eq("user_id", userId).maybeSingle();
  return parseMemberCommsPreferences(
    data && typeof data === "object" ? (data as { profile_data?: unknown }).profile_data : null,
  );
}

export async function saveMemberCommsPreferences(
  supabase: SupabaseClient,
  prefs: MemberCommsPreferences,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("update_user_profile_public", {
    p_profile_json: {
      profile_data: {
        [PROFILE_KEY]: {
          email_marketing: prefs.emailMarketing,
          sms_marketing: prefs.smsMarketing,
          push_marketing: prefs.pushMarketing,
        },
      },
    },
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { ok: false, message: error.message ?? "Impossible d’enregistrer les préférences." };
  return { ok: true };
}

export function allowsMarketingEmail(prefs: MemberCommsPreferences, kind: string): boolean {
  if (!isMarketingNotificationKind(kind)) return true;
  return prefs.emailMarketing;
}

export function allowsMarketingSms(prefs: MemberCommsPreferences, kind: string): boolean {
  if (!isMarketingNotificationKind(kind)) return true;
  return prefs.smsMarketing;
}

export function allowsMarketingPush(prefs: MemberCommsPreferences, kind: string): boolean {
  if (!isMarketingNotificationKind(kind)) return true;
  return prefs.pushMarketing;
}
