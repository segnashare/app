"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { SegnaDialogDismissButton, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import {
  dismissExchangeOnboardingSheetForSession,
  getExchangeOnboardingSheetDismissSnapshot,
  parseExchangeOnboardingSheetDismissSnapshot,
  subscribeExchangeOnboardingSheetDismiss,
  type ExchangeOnboardingSheetKind,
} from "@/lib/onboarding/in-app-onboarding";

type InAppOnboardingStackSheetFrameProps = {
  sheetKind: ExchangeOnboardingSheetKind;
  titleId: string;
  title: string;
  body: ReactNode;
  actions: ReactNode;
};

function getDismissServerSnapshot() {
  return "[]";
}

export function InAppOnboardingStackSheetFrame({
  sheetKind,
  titleId,
  title,
  body,
  actions,
}: InAppOnboardingStackSheetFrameProps) {
  const dismissSnapshot = useSyncExternalStore(
    subscribeExchangeOnboardingSheetDismiss,
    getExchangeOnboardingSheetDismissSnapshot,
    getDismissServerSnapshot,
  );
  const dismissed = parseExchangeOnboardingSheetDismissSnapshot(dismissSnapshot).has(sheetKind);

  if (dismissed) return null;

  const dismissForSession = () => {
    dismissExchangeOnboardingSheetForSession(window.sessionStorage, sheetKind);
  };

  return (
    <div
      className="relative rounded-2xl border border-zinc-300/90 bg-zinc-50/90 p-4 shadow-[0_8px_30px_rgba(24,24,27,0.08)] backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
    >
      <SegnaDialogDismissButton
        variant="overlay"
        onClick={dismissForSession}
        aria-label="Fermer pour cette session"
        className="right-1.5 top-1.5 h-8 w-8 [&_svg]:h-4 [&_svg]:w-4"
      />
      <div className="min-w-0 pr-7">
        <h2 id={titleId} className={segnaDialogTitleClass()}>
          {title}
        </h2>
        {body}
      </div>
      {actions}
    </div>
  );
}

