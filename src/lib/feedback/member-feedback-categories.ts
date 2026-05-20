export const MEMBER_FEEDBACK_CATEGORIES = [
  { id: "logistics", label: "Problème logistique (livraison, retour, relais…)" },
  { id: "bug", label: "Bug ou dysfonctionnement de l’app" },
  { id: "order", label: "Commande ou emprunt en cours" },
  { id: "item", label: "Article / dépôt / évaluation" },
  { id: "payment", label: "Paiement, crédits ou abonnement" },
  { id: "account", label: "Compte ou profil" },
  { id: "question", label: "Question générale" },
  { id: "other", label: "Autre" },
] as const;

export type MemberFeedbackCategoryId = (typeof MEMBER_FEEDBACK_CATEGORIES)[number]["id"];

const CATEGORY_IDS = new Set<string>(MEMBER_FEEDBACK_CATEGORIES.map((c) => c.id));

export function isMemberFeedbackCategoryId(value: string): value is MemberFeedbackCategoryId {
  return CATEGORY_IDS.has(value);
}

export function memberFeedbackCategoryLabel(category: MemberFeedbackCategoryId): string {
  return MEMBER_FEEDBACK_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}
