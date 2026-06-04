/** Courbes partagées (pastille wallet, reveal transaction). */
export const WALLET_PILL_EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const WALLET_PILL_EASE_IN_OUT = [0.45, 0, 0.55, 1] as const;

export const WALLET_PILL_SPRING = {
  pillGrow: { type: "spring" as const, stiffness: 320, damping: 26, mass: 0.85 },
  pillSettle: { type: "spring" as const, stiffness: 400, damping: 32, mass: 0.8 },
};

/** Durée totale séquence contenu (ms) — alignée sur la pastille. */
export const WALLET_PILL_FRAME_TOTAL_MS = 2400;

/** Scale cible au pic du grossissement. */
export const WALLET_PILL_GROW_SCALE = 1.1;

/** Secousse légère à l’apex (ms). */
export const WALLET_PILL_GROW_VIBRATE_MS = 320;
