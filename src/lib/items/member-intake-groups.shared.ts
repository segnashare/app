/** Max pièces par enveloppe d'envoi (colis). */
export const INTAKE_GROUP_MAX_ITEMS = 5;

export type IntakeGroupItem = {
  id: string;
  title: string;
  sortOrder: number;
};

export type IntakeGroupSnapshot = {
  id: string;
  items: IntakeGroupItem[];
  shipmentId: string | null;
  shipmentStatus: string | null;
  hasActiveLabel: boolean;
  /** Outtake : bordereau déjà généré (première pièce du colis). */
  labelUrl?: string | null;
  trackingNumber?: string | null;
};
