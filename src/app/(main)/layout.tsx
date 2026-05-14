import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { MainShell } from "@/components/layout/MainShell";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createPerfTracker } from "@/lib/perf/server-timing";

export default async function MainLayout({ children }: { children: ReactNode }) {
  const perf = createPerfTracker("main-layout");
  const { user, error: userError } = await perf.measure("auth.getUser", getCurrentAuthUser);

  if (userError || !user) {
    redirect("/auth/login");
  }

  const userState = await perf.measure("users.appState", () => getCurrentUserAppState(user.id));
  const isDemoMode = userState.onboarding_mode === "demo";

  const inAppOnboardingIntro =
    userState.onboarding_process === "intro"
      ? {
          userId: user.id,
          lastSignInAt: user.last_sign_in_at ?? null,
          referralInvite: userState.referralInviteForIntro,
        }
      : null;
  const inAppOnboardingRewardUserId = userState.onboarding_process === "reward" ? user.id : null;

  perf.log();

  return (
    <MainShell
      isDemoMode={isDemoMode}
      inAppOnboardingIntro={inAppOnboardingIntro}
      inAppOnboardingRewardUserId={inAppOnboardingRewardUserId}
      referrerBonusModal={userState.referrerBonusModal}
    >
      {children}
    </MainShell>
  );
}
