/** Texte discret (concurrence paniers autres membres). */
export function formatOtherMembersDiscreteLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 autre membre…";
  return `${count} autres membres…`;
}
