import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Valeurs affichées sur `/package?plan=x` (comparatif Guest vs SegnaX), alignées sur `billing_plan_entitlement_limits`. */
export type PlanEntitlementComparisonLimits = {
  guestIncludedOrders: number;
  guestMonthlyCredits: number;
  segnaXIncludedOrders: number;
  segnaXMonthlyCredits: number;
};

const FALLBACK: PlanEntitlementComparisonLimits = {
  guestIncludedOrders: 0,
  guestMonthlyCredits: 100,
  segnaXIncludedOrders: 2,
  segnaXMonthlyCredits: 500,
};

/** Valeurs de secours (SSR hors `plan=x` ou erreur lecture DB). */
export const PLAN_ENTITLEMENT_COMPARISON_FALLBACK = FALLBACK;

type EntitlementRow = {
  plan_code: string;
  included_orders_limit: number | null;
  monthly_consumption_points_grant: number | string | null;
  is_active?: boolean | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function pickActive(rows: EntitlementRow[] | null | undefined, planCode: string): EntitlementRow | undefined {
  return rows?.find((r) => r.plan_code === planCode && (r.is_active ?? true) !== false);
}

/**
 * Lit `billing_plan_entitlement_limits` (guest + segna_x) via le client admin.
 * En cas d’erreur ou de ligne manquante, retombe sur des valeurs produit stables.
 */
export async function fetchPlanEntitlementComparisonLimits(): Promise<PlanEntitlementComparisonLimits> {
  try {
    const admin = createSupabaseAdminClient() as any;
    const { data, error } = await admin
      .from("billing_plan_entitlement_limits")
      .select("plan_code, included_orders_limit, monthly_consumption_points_grant, is_active")
      .in("plan_code", ["guest", "segna_x"]);

    if (error || !data?.length) {
      return FALLBACK;
    }

    const rows = data as EntitlementRow[];

    const guest = pickActive(rows, "guest");
    const segnaX = pickActive(rows, "segna_x");

    return {
      guestIncludedOrders: num(guest?.included_orders_limit),
      guestMonthlyCredits: num(guest?.monthly_consumption_points_grant),
      segnaXIncludedOrders: num(segnaX?.included_orders_limit),
      segnaXMonthlyCredits: num(segnaX?.monthly_consumption_points_grant),
    };
  } catch {
    return FALLBACK;
  }
}
