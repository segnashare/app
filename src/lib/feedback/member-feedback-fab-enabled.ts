/** Pastille signalement membre : `NEXT_PUBLIC_SEGNA_MEMBER_FEEDBACK_FAB=1` dans `.env.local`. */
export function isMemberFeedbackFabEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SEGNA_MEMBER_FEEDBACK_FAB?.trim() === "1";
}
