export type AnswersTabId = "about" | "daily" | "favorites" | "inspirations" | "stories";

export const ANSWERS_TABS: Array<{ id: AnswersTabId; label: string }> = [
  { id: "about", label: "À propos de moi" },
  { id: "daily", label: "Ton quotidien" },
  { id: "favorites", label: "Tes coups de coeur" },
  { id: "inspirations", label: "Inspis" },
  { id: "stories", label: "Histoires vécues" },
];

export const ANSWERS_PROMPTS_BY_TAB: Record<AnswersTabId, string[]> = {
  about: [
    "On reconnaît mon style à…",
    "Je me sens le plus moi-même quand je porte…",
    "Mon mood vestimentaire du moment, c’est…",
    "Si mon style était une ville, ce serait…",
    "La vibe que j’essaie toujours de donner, c’est…",
  ],
  daily: [
    "Mon dressing, c’est plutôt…",
    "Mon uniforme de tous les jours, c’est…",
    "Mon meilleur achat seconde main, c’est…",
    "La pièce que je prête le plus à mes potes, c’est…",
    "On ne me verra jamais porter…",
  ],
  favorites: [
    "La pièce que je garderais pour toujours, c’est…",
    "Dans mon dressing, je porte en boucle…",
    "La pièce que tout le monde me complimente, c’est…",
    "Ma tenue safe quand je ne sais pas quoi mettre, c’est…",
    "Pour sortir danser, je porte toujours…",
    "Mon look idéal pour un date, c’est…",
  ],
  inspirations: [
    "Mon influenceuse style préférée, c’est…",
    "Le compte Insta/Pinterest qui m’inspire le plus, c’est…",
    "Le film ou la série qui a le plus influencé mon style, c’est…",
    "La ‘règle mode’ que j’ignore complètement, c’est…",
    "Le conseil style que je donne tout le temps, c’est…",
  ],
  stories: [
    "Mon pire fashion faux pas, c’était…",
    "Le look qui m’a donné le plus confiance, c’est…",
    "La fois où ma tenue a tout changé, c’était quand…",
    "Ma pièce de rêve, ce serait…",
    "Sur ma wishlist depuis trop longtemps, il y a…",
    "Avec Segna, j’aimerais oser enfin…",
  ],
};
