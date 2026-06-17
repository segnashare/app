import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { OnboardingInAppStep } from "@/lib/analytics/events";
import { trackClientEvent } from "@/lib/analytics/track-client";

type StepProps = {
  fromStep: OnboardingInAppStep | string | null;
  toStep: OnboardingInAppStep | string;
  trigger: string;
};

export function trackOnboardingInAppStepClient(props: StepProps): void {
  trackClientEvent(ANALYTICS_EVENTS.onboardingInAppStepCompleted, {
    from_step: props.fromStep,
    to_step: props.toStep,
    trigger: props.trigger,
  });
}
