import { getServerEnv } from "@/lib/config/env";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type MemberEngagementReminderConfig = {
  /** 1er rappel onboarding : âge minimum du compte (défaut J+3). */
  onboardingFirstReminderMinAgeMs: number;
  /** 2e rappel onboarding : âge minimum du compte (défaut J+10). */
  onboardingFollowupMinAgeMs: number;
  likedItemsInactiveMs: number;
  abandonedCartMinAgeMs: number;
  maxCandidatesPerKind: number;
};

/** Seuils rappels engagement (env optionnels, défauts produit). */
export function getMemberEngagementReminderConfig(): MemberEngagementReminderConfig {
  const env = getServerEnv();
  const onboardingFirstDays = parsePositiveInt(env.SEGNA_REMINDER_ONBOARDING_DAYS, 3);
  const onboardingFollowupDays = parsePositiveInt(env.SEGNA_REMINDER_ONBOARDING_FOLLOWUP_DAYS, 10);
  const inactiveDays = parsePositiveInt(env.SEGNA_REMINDER_INACTIVE_DAYS, 7);
  const abandonedCartHours = parsePositiveInt(env.SEGNA_REMINDER_ABANDONED_CART_HOURS, 48);
  const maxCandidates = parsePositiveInt(env.SEGNA_REMINDER_MAX_PER_RUN, 80);

  return {
    onboardingFirstReminderMinAgeMs: onboardingFirstDays * MS_PER_DAY,
    onboardingFollowupMinAgeMs: onboardingFollowupDays * MS_PER_DAY,
    likedItemsInactiveMs: inactiveDays * MS_PER_DAY,
    abandonedCartMinAgeMs: abandonedCartHours * MS_PER_HOUR,
    maxCandidatesPerKind: maxCandidates,
  };
}
