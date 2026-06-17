import "server-only";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { OnboardingInAppStep } from "@/lib/analytics/events";
import { trackServerEvent } from "@/lib/analytics/track-server";

type StepProps = {
  fromStep: OnboardingInAppStep | string | null;
  toStep: OnboardingInAppStep | string;
  trigger: string;
};

export function trackOnboardingInAppStepServer(
  userId: string,
  props: StepProps,
): void {
  trackServerEvent(
    ANALYTICS_EVENTS.onboardingInAppStepCompleted,
    {
      distinctId: userId,
      insertId: `onboarding_in_app:${userId}:${props.fromStep ?? "null"}:${props.toStep}:${props.trigger}`,
    },
    {
      from_step: props.fromStep,
      to_step: props.toStep,
      trigger: props.trigger,
    },
  );
}
