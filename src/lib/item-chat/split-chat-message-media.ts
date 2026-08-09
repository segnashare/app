/** Détecte une URL d’image (extension ou URL signée Storage Supabase). */
export function isLikelyChatImageUrl(value: string): boolean {
  const s = value.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(s)) return true;
  if (/\/storage\/v1\/object\//i.test(s)) return true;
  return false;
}

/** Sépare le texte des lignes qui sont uniquement des URLs d’image. */
export function splitChatMessageMedia(body: string): { text: string; imageUrls: string[] } {
  const imageUrls: string[] = [];
  const textLines: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (isLikelyChatImageUrl(trimmed)) imageUrls.push(trimmed);
    else textLines.push(line);
  }
  return { text: textLines.join("\n").trimEnd(), imageUrls };
}
