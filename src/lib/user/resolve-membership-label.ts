/** Résolution du label d’abonnement (aligné sur la page panier). */

export type MembershipLabel = "Guest" | "Membre +" | "Membre X";

function toMembershipLabelFromRoles(roles: string[]): MembershipLabel {
  const normalized = roles.map((role) => role.trim().toLowerCase());
  if (normalized.some((role) => role.includes("segna_x") || role.includes("membre_x") || role.includes("premium") || role.includes("member_x"))) {
    return "Membre X";
  }
  if (normalized.some((role) => role.includes("segna_plus") || role.includes("membre_plus") || role.includes("plus") || role.includes("member_plus"))) {
    return "Membre +";
  }
  return "Guest";
}

type MembershipState = {
  plan_code?: string | null;
  subscription_status?: string | null;
};

function toMembershipLabelFromBilling(state: MembershipState | null | undefined): MembershipLabel {
  const status = (state?.subscription_status ?? "").toLowerCase();
  const planCode = (state?.plan_code ?? "").toLowerCase();
  const isActive = status === "active" || status === "trialing";
  if (!isActive) return "Guest";
  if (planCode === "segna_x") return "Membre X";
  if (planCode === "segna_plus") return "Membre +";
  return "Guest";
}

export async function resolveMembershipLabel(supabase: any, userId: string): Promise<MembershipLabel> {
  const [membershipStateRes, subscriptionRowRes, rolesRes] = await Promise.all([
    supabase.rpc("get_current_membership_state"),
    supabase
      .from("user_subscriptions")
      .select("plan_code,status")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  const roles: string[] = (rolesRes.data ?? []).map((entry: { role?: string | null }) => entry.role ?? "").filter(Boolean);
  const membershipLabelFromRpc = toMembershipLabelFromBilling((membershipStateRes.data ?? null) as MembershipState | null);
  const subRow = subscriptionRowRes.data as { plan_code?: string | null; status?: string | null } | null;
  const membershipLabelFromSubscriptionTable =
    subscriptionRowRes.error == null && subRow
      ? toMembershipLabelFromBilling({
          plan_code: subRow.plan_code ?? null,
          subscription_status: subRow.status ?? null,
        })
      : ("Guest" as const);

  if (membershipLabelFromSubscriptionTable !== "Guest") return membershipLabelFromSubscriptionTable;
  if (membershipLabelFromRpc !== "Guest") return membershipLabelFromRpc;
  return toMembershipLabelFromRoles(roles);
}
