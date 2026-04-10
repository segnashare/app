/** Dégradés pseudo-aléatoires pour cartes catégorie / marque CMS (aligné boutique). */
const PSEUDO_FRAME_TAGLINES = [
  "Edito Segna",
  "Sélection du moment",
  "Vu sur le feed",
  "Tendance capsule",
  "Drop exclusif",
  "Nouveau chez Segna",
];

const PSEUDO_FRAME_COLORS = [
  "from-[#FDE68A] to-[#FCA5A5]",
  "from-[#BFDBFE] to-[#C4B5FD]",
  "from-[#A7F3D0] to-[#67E8F9]",
  "from-[#FDBA74] to-[#F9A8D4]",
  "from-[#DDD6FE] to-[#93C5FD]",
  "from-[#FECACA] to-[#FDE68A]",
];

export function pickPseudoFrame(seed: string): { color: string; tag: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    color: PSEUDO_FRAME_COLORS[hash % PSEUDO_FRAME_COLORS.length]!,
    tag: PSEUDO_FRAME_TAGLINES[hash % PSEUDO_FRAME_TAGLINES.length]!,
  };
}
