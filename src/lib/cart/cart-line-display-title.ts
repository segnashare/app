/** Titre pièce sans marque (préfixe / suffixe entre parenthèses). */
export function cartLineDisplayTitleWithoutBrand(itemName: string, brand: string | null | undefined): string {
  let title = itemName.trim()
  const brandTrim = brand?.trim()
  if (!brandTrim) return title

  const suffix = `(${brandTrim})`
  if (title.endsWith(suffix)) {
    title = title.slice(0, -suffix.length).trim()
  }

  const prefixes = [`${brandTrim} - `, `${brandTrim} — `, `${brandTrim}: `]
  for (const prefix of prefixes) {
    if (title.toLowerCase().startsWith(prefix.toLowerCase())) {
      title = title.slice(prefix.length).trim()
      break
    }
  }

  return title || itemName.trim()
}
