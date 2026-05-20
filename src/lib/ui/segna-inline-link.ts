import { cn } from "@/lib/utils/cn";

/** Lien d’action inline (type « En savoir plus », signalement commande). */
export const segnaInlineActionLinkClass = cn(
  "font-semibold text-zinc-700 underline decoration-zinc-400/80 underline-offset-[0.18em] transition hover:text-zinc-900 hover:decoration-zinc-600/50",
);

/** Lien discret en en-tête de page (remplace « Aide commande »). */
export const segnaHeaderInlineLinkClass = cn(
  "p-0 text-[13px] font-medium text-zinc-500 underline decoration-zinc-400/80 underline-offset-[3px] transition hover:text-zinc-800 hover:decoration-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400",
);
