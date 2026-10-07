export const PAID_PLAN_CODES = ['segna_plus', 'segna_x', 'club', 'club_plus'] as const

export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number]

export type BillingPlanCode = 'guest' | PaidPlanCode

export function isPaidPlanCode(value: string | null | undefined): value is PaidPlanCode {
  return value === 'segna_plus' || value === 'segna_x' || value === 'club' || value === 'club_plus'
}

export function isBillingPlanCode(value: string | null | undefined): value is BillingPlanCode {
  return value === 'guest' || isPaidPlanCode(value)
}
