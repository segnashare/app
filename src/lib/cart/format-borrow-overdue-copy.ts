/** Sous-texte carte commande / bannière : « Retard de X jour(s) ». */
export function formatBorrowOverdueDaysLabelFr(lateDayIndex: number): string {
  const d = Math.max(1, Math.trunc(lateDayIndex));
  if (d === 1) return "Retard de 1 jour";
  return `Retard de ${d} jours`;
}
