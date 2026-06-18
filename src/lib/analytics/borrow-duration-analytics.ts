/** Libellés stables PostHog pour les durées de location checkout (7j / 14j / 1 mois). */
export type BorrowDurationAnalyticsLabel = "7_jours" | "14_jours" | "1_mois" | string;

export function borrowDurationLabelForAnalytics(durationDays: number): BorrowDurationAnalyticsLabel {
  if (durationDays === 7) return "7_jours";
  if (durationDays === 14) return "14_jours";
  if (durationDays === 30) return "1_mois";
  return `${durationDays}_jours`;
}

export function borrowDurationAnalyticsProps(durationDays: number): {
  borrow_duration_days: number;
  borrow_duration_label: BorrowDurationAnalyticsLabel;
} {
  return {
    borrow_duration_days: durationDays,
    borrow_duration_label: borrowDurationLabelForAnalytics(durationDays),
  };
}
