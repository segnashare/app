import type { SupabaseClient } from "@supabase/supabase-js";

import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";

export function buildReferrerBonusSmsBody(referredFirstNameForSms: string): string {
  const name = referredFirstNameForSms.trim() || "Ton invitée";
  return `Segna : ${name} vient de rejoindre Segna grâce à ton parrainage. Tu gagnes un échange inclus !`;
}

/**
 * Envoie au **parrain** un SMS transactionnel (idempotent par `referrals.id`) lorsqu’un filleul est qualifié.
 * À appeler après qualification du parrainage (tél. vérifié + onboarding complété), ou via cron de secours.
 */
export async function dispatchReferrerBonusSmsForReferredUser(
  admin: SupabaseClient,
  referredUserId: string,
): Promise<void> {
  const { data: refRow, error: refErr } = await admin
    .from("referrals")
    .select("id, referrer_user_id")
    .eq("referred_user_id", referredUserId)
    .eq("status", "qualified")
    .maybeSingle();

  if (refErr || !refRow?.id || !refRow.referrer_user_id) return;

  const [{ data: modalRow }, { data: referredUserRow }] = await Promise.all([
    admin.from("users").select("referrer_bonus_modal").eq("id", refRow.referrer_user_id).maybeSingle(),
    admin.from("users").select("first_name").eq("id", referredUserId).maybeSingle(),
  ]);

  const modal = modalRow?.referrer_bonus_modal as Record<string, unknown> | null | undefined;
  const referredFirstName =
    typeof referredUserRow?.first_name === "string" ? referredUserRow.first_name.trim() : "";
  const referredNameFromModal =
    typeof modal?.referred_display_name === "string" && modal.referred_display_name.trim()
      ? modal.referred_display_name.trim()
      : "";
  /** SMS : prénom filleul à jour ; repli sur le libellé figé dans la modale (e-mail / ancien flux). */
  const referredFirstNameForSms = referredFirstName || referredNameFromModal || "Ton invitée";

  await sendMemberSmsOnlyNotification(admin, {
    userId: refRow.referrer_user_id,
    kind: NotificationKind.referralReferrerBonus,
    idempotencyKey: `txn:referral_referrer_bonus_sms:${refRow.id}`,
    metadata: { referred_user_id: referredUserId, referral_id: refRow.id },
    smsBody: buildReferrerBonusSmsBody(referredFirstNameForSms),
    transactionalSms: true,
  });
}
