function normalizeSectionHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const HOME_NOS_OFFRES_SECTION_KEYS = new Set(["cart_offers", "home_nos_offres", "cms_home_nos_offres"]);

/** Section CMS Accueil titrée « Nos offres » (ou clé dédiée). */
export function isHomeNosOffresSection(sectionKey: string, title: string | null | undefined): boolean {
  if (normalizeSectionHeading(title ?? "") === "nos offres") return true;
  const key = sectionKey.trim().toLowerCase();
  if (HOME_NOS_OFFRES_SECTION_KEYS.has(key)) return true;
  return key.includes("nos_offres");
}
