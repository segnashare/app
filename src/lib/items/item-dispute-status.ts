/** Aligné sur l’enum Postgres `item_dispute_status` et le BO (`disputes/update-status`). */
export type ItemDisputeStatus = "open" | "in_review" | "resolved" | "closed";

export const ITEM_DISPUTE_STATUSES = ["open", "in_review", "resolved", "closed"] as const satisfies readonly ItemDisputeStatus[];

export function isItemDisputeStatus(value: string): value is ItemDisputeStatus {
  return (ITEM_DISPUTE_STATUSES as readonly string[]).includes(value);
}
