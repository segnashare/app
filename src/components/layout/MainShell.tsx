import type { ReactNode } from "react";
import { Suspense } from "react";

import { PreCartExitPathTracker } from "@/components/cart/PreCartExitPathTracker";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { DesktopMobileOnlyGate } from "@/components/layout/DesktopMobileOnlyGate";
import { MainTabRoutePrefetch } from "@/components/layout/MainTabRoutePrefetch";
import { ItemChatBubble } from "@/components/item-chat/ItemChatBubble";
import { ItemChatProvider } from "@/components/item-chat/ItemChatProvider";
import { InAppOnboardingTaskFab } from "@/components/onboarding/InAppOnboardingTaskFab";
import { FloatingViewCartButton } from "@/components/layout/FloatingViewCartButton";
import { PageChromeLoadingProvider } from "@/components/layout/PageChromeLoadingContext";
import { InAppOnboardingIntroModal } from "@/components/onboarding/InAppOnboardingIntroModal";
import { InAppOnboardingRewardModal } from "@/components/onboarding/InAppOnboardingRewardModal";
import { ReferrerBonusModal, type ReferrerBonusModalPayload } from "@/components/referral/ReferrerBonusModal";
import { BorrowOverdueAppGateModal } from "@/components/emprunt/BorrowOverdueAppGateModal";
import { BorrowOverduePaymentRecoveryBanner } from "@/components/emprunt/BorrowOverduePaymentRecoveryBanner";
import { MemberReceiptPendingGateModal } from "@/components/commande/MemberReceiptPendingGateModal";
import type { MemberReceiptPendingGatePayload } from "@/lib/cart/fetch-member-pending-receipt-gate";
import type { MemberBorrowOverdueAppGate } from "@/lib/emprunt/fetch-member-borrow-overdue-app-gate";
import type { ReferralInviteIntroKind } from "@/lib/auth/current-user-server";
import { isDesktopMobileGateEnabled } from "@/lib/config/desktop-mobile-gate-enabled";
import { IN_APP_ONBOARDING_UI_ENABLED } from "@/lib/onboarding/in-app-onboarding";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingIntroGate = {
  userId: string;
  lastSignInAt: string | null;
  referralInvite: ReferralInviteIntroKind;
};

type MainShellProps = {
  children: ReactNode;
  isDemoMode?: boolean;
  inAppOnboardingIntro?: InAppOnboardingIntroGate | null;
  inAppOnboardingRewardUserId?: string | null;
  referrerBonusModal?: ReferrerBonusModalPayload | null;
  memberReceiptPendingGate?: MemberReceiptPendingGatePayload | null;
  memberBorrowOverdueAppGate?: MemberBorrowOverdueAppGate | null;
};

export function MainShell({
  children,
  isDemoMode = false,
  inAppOnboardingIntro = null,
  inAppOnboardingRewardUserId = null,
  referrerBonusModal = null,
  memberReceiptPendingGate = null,
  memberBorrowOverdueAppGate = null,
}: MainShellProps) {
  const desktopMobileGate = isDesktopMobileGateEnabled();

  return (
    <PageChromeLoadingProvider>
    <ItemChatProvider source="app">
    <div className="min-h-[100dvh] bg-zinc-100 text-zinc-900">
      {desktopMobileGate ? <DesktopMobileOnlyGate /> : null}
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-x-hidden bg-white md:my-6 md:min-h-[calc(100dvh-48px)] md:rounded-[32px] md:border md:border-zinc-200 md:shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <PreCartExitPathTracker />
        <MainTabRoutePrefetch />
        {isDemoMode ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
            Mode demo: modifications et paiements desactives.
          </div>
        ) : null}
        {memberBorrowOverdueAppGate ? (
          <BorrowOverduePaymentRecoveryBanner gate={memberBorrowOverdueAppGate} />
        ) : null}
        <div className={cn("flex min-h-[100dvh] flex-col md:min-h-[calc(100dvh-48px)]")}>{children}</div>
      </div>
      <FloatingViewCartButton />
      {IN_APP_ONBOARDING_UI_ENABLED ? <InAppOnboardingTaskFab /> : null}
      <ItemChatBubble />
      <BottomTabBar />
      {IN_APP_ONBOARDING_UI_ENABLED && inAppOnboardingIntro ? (
        <InAppOnboardingIntroModal
          userId={inAppOnboardingIntro.userId}
          lastSignInAt={inAppOnboardingIntro.lastSignInAt}
          referralInvite={inAppOnboardingIntro.referralInvite}
        />
      ) : null}
      {IN_APP_ONBOARDING_UI_ENABLED && inAppOnboardingRewardUserId ? (
        <InAppOnboardingRewardModal />
      ) : null}
      {referrerBonusModal ? <ReferrerBonusModal payload={referrerBonusModal} /> : null}
      <MemberReceiptPendingGateModal gate={memberReceiptPendingGate} />
      <Suspense fallback={null}>
        <BorrowOverdueAppGateModal gate={memberBorrowOverdueAppGate} />
      </Suspense>
    </div>
    </ItemChatProvider>
    </PageChromeLoadingProvider>
  );
}
