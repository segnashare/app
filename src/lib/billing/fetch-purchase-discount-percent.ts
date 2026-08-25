import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

function planCodeForMembership(label: MembershipLabel): "segna_x" | "segna_plus" | null {
  if (label === "Membre X") return "segna_x";
  if (label === "Membre +") return "segna_plus";
  return null;
}

/** Lit `purchase_discount_percent` du plan actif (0 si guest / absent). */
export async function fetchPurchaseDiscountPercentForMembership(
  admin: { from: (t: string) => any },
  membershipLabel: MembershipLabel,
): Promise<number> {
  const planCode = planCodeForMembership(membershipLabel);
  if (!planCode) return 0;
  try {
    const { data, error } = await admin
      .from("billing_plan_entitlement_limits")
      .select("purchase_discount_percent")
      .eq("plan_code", planCode)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return planCode === "segna_x" ? 20 : 0;
    const raw = Number(data?.purchase_discount_percent ?? 0);
    if (!Number.isFinite(raw)) return planCode === "segna_x" ? 20 : 0;
    return Math.min(100, Math.max(0, Math.trunc(raw)));
  } catch {
    return planCode === "segna_x" ? 20 : 0;
  }
}
