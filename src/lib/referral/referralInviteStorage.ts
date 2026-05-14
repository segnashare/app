import { REFERRAL_CODE_SESSION_KEY, REFERRAL_COOKIE_NAME } from "./referralInviteConstants";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function persistReferralCodeFromSearchParam(refParam: string | null): void {
  if (typeof window === "undefined") return;
  const v = typeof refParam === "string" ? refParam.trim() : "";
  if (!v) return;
  try {
    sessionStorage.setItem(REFERRAL_CODE_SESSION_KEY, v);
  } catch {
    // private mode / quota
  }
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = `${REFERRAL_COOKIE_NAME}=${encodeURIComponent(v)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${
    secure ? "; Secure" : ""
  }`;
}

/** Lu au moment du `bootstrap_user_after_signup` (session puis cookie). */
export function readReferralCodeForBootstrap(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const s = sessionStorage.getItem(REFERRAL_CODE_SESSION_KEY);
    if (s && s.trim()) return s.trim();
  } catch {
    // ignore
  }
  const parts = `; ${document.cookie}`.split(`; ${REFERRAL_COOKIE_NAME}=`);
  if (parts.length < 2) return null;
  const part = parts.pop()?.split(";").shift() ?? "";
  if (!part) return null;
  try {
    return decodeURIComponent(part).trim() || null;
  } catch {
    return part.trim() || null;
  }
}

export function clearReferralInviteClient(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(REFERRAL_CODE_SESSION_KEY);
  } catch {
    // ignore
  }
  document.cookie = `${REFERRAL_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
