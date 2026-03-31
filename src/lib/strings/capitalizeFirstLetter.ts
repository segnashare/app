/**
 * Met en majuscule la première lettre du texte (reste inchangé), après trim.
 * Utilisé pour prénoms / noms alignés avec `format_display_name_from_names` côté Postgres.
 */
export function capitalizeFirstLetter(value: string): string {
  const t = value.trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("fr-FR") + t.slice(1);
}
