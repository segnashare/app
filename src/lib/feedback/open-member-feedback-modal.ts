export const MEMBER_FEEDBACK_OPEN_EVENT = "segna:open-member-feedback";

export function openMemberFeedbackModal(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEMBER_FEEDBACK_OPEN_EVENT));
}
