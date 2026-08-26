/**
 * Suspension ops sur `cart_disputes.ops_soft_gate` (modale membre, pas auth).
 * `dismissible: false` = hard (bloquante) ; `true` = soft (croix).
 */

export type CartDisputeOpsSoftGate = {
  active: boolean;
  dismissible: boolean;
  activatedAt?: string | null;
  activatedBy?: string | null;
  note?: string | null;
};

export function parseCartDisputeOpsSoftGate(raw: unknown): CartDisputeOpsSoftGate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { active: false, dismissible: false };
  }
  const o = raw as Record<string, unknown>;
  return {
    active: Boolean(o.active),
    dismissible: Boolean(o.dismissible),
    activatedAt: typeof o.activatedAt === "string" ? o.activatedAt : null,
    activatedBy: typeof o.activatedBy === "string" ? o.activatedBy : null,
    note: typeof o.note === "string" ? o.note : null,
  };
}

export function buildCartDisputeOpsSoftGate(input: {
  active: boolean;
  dismissible?: boolean;
  actorUserId?: string | null;
  note?: string | null;
  prev?: CartDisputeOpsSoftGate | null;
}): CartDisputeOpsSoftGate {
  const nowIso = new Date().toISOString();
  if (!input.active) {
    return { active: false, dismissible: false };
  }
  return {
    active: true,
    dismissible: Boolean(input.dismissible),
    activatedAt: input.prev?.activatedAt ?? nowIso,
    activatedBy: input.actorUserId ?? input.prev?.activatedBy ?? null,
    note: input.note?.trim() || input.prev?.note || null,
  };
}
