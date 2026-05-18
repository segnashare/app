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

/** Cartes onboarding in-app sur la page Échange (pile header). */
export const EXCHANGE_ONBOARDING_SHEET_KINDS = ["profile", "kyc", "panier", "exchange"] as const;
export type ExchangeOnboardingSheetKind = (typeof EXCHANGE_ONBOARDING_SHEET_KINDS)[number];

const EXCHANGE_SHEET_DISMISS_STORAGE_KEY = "segna_in_app_onboarding_exchange_sheet_dismiss_v1";

type ExchangeSheetDismissPayload = {
  dismissed: ExchangeOnboardingSheetKind[];
};

const exchangeSheetDismissListeners = new Set<() => void>();

function notifyExchangeSheetDismissListeners() {
  exchangeSheetDismissListeners.forEach((l) => l());
}

function readExchangeSheetDismissPayload(storage: Storage): ExchangeSheetDismissPayload {
  const raw = storage.getItem(EXCHANGE_SHEET_DISMISS_STORAGE_KEY);
  if (!raw) return { dismissed: [] };
  try {
    const parsed = JSON.parse(raw) as ExchangeSheetDismissPayload;
    if (!Array.isArray(parsed.dismissed)) return { dismissed: [] };
    const dismissed = parsed.dismissed.filter((k): k is ExchangeOnboardingSheetKind =>
      (EXCHANGE_ONBOARDING_SHEET_KINDS as readonly string[]).includes(k),
    );
    return { dismissed };
  } catch {
    return { dismissed: [] };
  }
}

export function dismissExchangeOnboardingSheetForSession(
  storage: Storage,
  kind: ExchangeOnboardingSheetKind,
): void {
  const payload = readExchangeSheetDismissPayload(storage);
  if (payload.dismissed.includes(kind)) return;
  storage.setItem(
    EXCHANGE_SHEET_DISMISS_STORAGE_KEY,
    JSON.stringify({ dismissed: [...payload.dismissed, kind] }),
  );
  notifyExchangeSheetDismissListeners();
}

export function isExchangeOnboardingSheetDismissedForSession(
  storage: Storage | null | undefined,
  kind: ExchangeOnboardingSheetKind,
): boolean {
  if (!storage) return false;
  return readExchangeSheetDismissPayload(storage).dismissed.includes(kind);
}

export function getExchangeOnboardingSheetDismissSnapshot(): string {
  if (typeof window === "undefined") return "[]";
  return JSON.stringify(readExchangeSheetDismissPayload(window.sessionStorage).dismissed);
}

export function subscribeExchangeOnboardingSheetDismiss(onStoreChange: () => void): () => void {
  exchangeSheetDismissListeners.add(onStoreChange);
  return () => exchangeSheetDismissListeners.delete(onStoreChange);
}

export function parseExchangeOnboardingSheetDismissSnapshot(snapshot: string): Set<ExchangeOnboardingSheetKind> {
  try {
    const arr = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter((k): k is ExchangeOnboardingSheetKind =>
        typeof k === "string" && (EXCHANGE_ONBOARDING_SHEET_KINDS as readonly string[]).includes(k),
      ),
    );
  } catch {
    return new Set();
  }
}
