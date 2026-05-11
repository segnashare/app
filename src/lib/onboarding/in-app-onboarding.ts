/**
 * Aligné sur le type Postgres `public.onboarding_process_status` (voir DB).
 * Ordre métier : intro → profile → kyc → panier → offer → exchange → reward → finished
 */
export const ONBOARDING_PROCESS_STATUS = [
  "intro",
  "profile",
  "kyc",
  "panier",
  "offer",
  "exchange",
  "reward",
  "finished",
] as const;

export type OnboardingProcessStatus = (typeof ONBOARDING_PROCESS_STATUS)[number];

const INTRO_SNOOZE_STORAGE_KEY = "segna_in_app_onboarding_intro_snooze_v1";

type IntroSnoozePayload = {
  userId: string;
  /** Valeur `User.last_sign_in_at` au moment du snooze : une nouvelle connexion change la date → la modale réapparaît. */
  lastSignInAt: string;
};

export function writeIntroSnoozeForAuthSession(
  storage: Storage,
  userId: string,
  lastSignInAt: string | null | undefined,
): void {
  const payload: IntroSnoozePayload = {
    userId,
    lastSignInAt: lastSignInAt ?? "",
  };
  storage.setItem(INTRO_SNOOZE_STORAGE_KEY, JSON.stringify(payload));
}

export function isIntroSnoozedForAuthSession(
  storage: Storage | null | undefined,
  userId: string,
  lastSignInAt: string | null | undefined,
): boolean {
  if (!storage) return false;
  const raw = storage.getItem(INTRO_SNOOZE_STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as IntroSnoozePayload;
    if (parsed.userId !== userId) return false;
    return (parsed.lastSignInAt ?? "") === (lastSignInAt ?? "");
  } catch {
    return false;
  }
}
