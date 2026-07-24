import type {SupabaseClient} from "@supabase/supabase-js";

/**
 * Tunnel website (OTP → nom+adresse → naissance → tailles) terminé
 * ou déjà passé aux étapes app (`/onboarding/3`+).
 */
function isPastWebsiteCheckoutOnboarding(currentStep: string | null | undefined): boolean {
  if (!currentStep) return false;
  const past = [
    "/onboarding/3",
    "/onboarding/work",
    "/onboarding/location",
    "/onboarding/style",
    "/onboarding/brands",
    "/onboarding/budget",
    "/onboarding/share",
    "/onboarding/privacy",
    "/onboarding/end",
    "/onboarding/phone",
  ];
  return past.some((p) => currentStep === p || currentStep.startsWith(`${p}/`));
}

async function hasCheckoutSizes(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const profileId = (profile as { id?: string } | null)?.id;
  if (!profileId) return false;

  const { data: rows } = await supabase
    .from("user_profile_sizes")
    .select("category")
    .eq("user_profile_id", profileId)
    .in("category", ["top", "bottom", "shoes"]);

  const cats = new Set(((rows ?? []) as Array<{ category: string }>).map((r) => r.category));
  return cats.has("top") && cats.has("bottom") && cats.has("shoes");
}

export function getWebsiteOrigin(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_WEBSITE_URL?.trim() || process.env.SEGNA_WEBSITE_URL?.trim() || "";
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://localhost:3002";
  return "https://www.segnashare.com";
}

/**
 * Reprise onboarding website via callback (hash tokens → session → `/signin?resume=1`).
 */
export function websiteOnboardingResumeUrl(): string {
  const next = encodeURIComponent("/signin?resume=1");
  return `${getWebsiteOrigin()}/auth/callback?next=${next}`;
}

/**
 * `true` si le membre peut entrer dans l’app (tunnel website fini).
 * Sinon → renvoyer vers le site pour finir nom / adresse / naissance / tailles.
 */
export async function isWebsiteCheckoutTunnelComplete(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const [{ data: member }, { data: onboarding }] = await Promise.all([
    supabase.from("users").select("first_name, birth_date, adress").eq("id", userId).maybeSingle(),
    supabase
      .from("onboarding_sessions")
      .select("current_step, status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const row = member as {
    first_name?: string | null;
    birth_date?: string | null;
    adress?: string | null;
  } | null;
  const progress = onboarding as { current_step?: string | null; status?: string | null } | null;

  if (progress?.status === "completed" || isPastWebsiteCheckoutOnboarding(progress?.current_step)) {
    return true;
  }

  const hasName = (row?.first_name ?? "").trim().length >= 2;
  const hasAddress = (row?.adress ?? "").trim().length > 0;
  const hasBirth = Boolean(row?.birth_date);
  if (!(hasName && hasAddress && hasBirth)) return false;

  return hasCheckoutSizes(supabase, userId);
}
