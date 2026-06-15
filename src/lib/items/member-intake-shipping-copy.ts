export type MemberIntakeShippingGroupItem = {
  id: string;
  title: string | null;
};

export function memberIntakeShippingGroupTitles(
  focusItemId: string,
  focusTitle: string | null | undefined,
  orderedIds: string[],
  groupItems?: MemberIntakeShippingGroupItem[],
): string[] {
  const ids =
    orderedIds.length > 0
      ? [...new Set(orderedIds.map((id) => id.trim()).filter(Boolean))]
      : [focusItemId.trim()].filter(Boolean);

  const titleById = new Map<string, string>();
  for (const row of groupItems ?? []) {
    const id = row.id.trim();
    if (!id) continue;
    const title = row.title?.trim();
    if (title) titleById.set(id, title);
  }
  const focusId = focusItemId.trim();
  const focus = focusTitle?.trim();
  if (focus) titleById.set(focusId, focus);

  return ids.map((id) => titleById.get(id) ?? (id === focusId && focus ? focus : "Pièce"));
}

export function memberIntakeInTransitShippingBody(titles: string[]): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) {
    return "Tes prêts sont en route vers Segna. Retrouve le suivi sur la page dédiée.";
  }
  if (clean.length === 1) {
    return `Ton prêt est en route vers Segna : ${clean[0]}. Retrouve le suivi sur la page dédiée.`;
  }
  return `Tes ${clean.length} prêts sont en route vers Segna : ${clean.join(", ")}. Retrouve le suivi sur la page dédiée.`;
}

export function memberIntakeShippingCtaLabel(
  mode: "track" | "ship",
  titles: string[],
): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  const n = clean.length;
  if (mode === "track") {
    if (n > 1) return `Suivre ${n} prêts`;
    return clean[0] ? `Suivre ${clean[0]}` : "Suivre mon envoi";
  }
  if (n > 1) return `Expédier ${n} prêts`;
  return clean[0] ? `Expédie ${clean[0]}` : "Expédie mon prêt";
}

export function memberIntakeExpeditionStatusLine(titles: string[]): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return "Tes prêts sont en route vers Segna.";
  if (clean.length === 1) return `Ton prêt est en route vers Segna : ${clean[0]}.`;
  return `Tes ${clean.length} prêts sont en route vers Segna : ${clean.join(", ")}.`;
}
