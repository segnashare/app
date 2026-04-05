import fs from "node:fs";
import path from "node:path";

import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

function displayNameFromFilename(base: string): string {
  const human = base.replace(/_/g, " ").replace(/-/g, " ").trim();
  return human.length > 0 ? human : "Prêteuse";
}

/**
 * Prêteuses décoratives : images dans `public/ressources/faux_profils`.
 * Le nom affiché = nom du fichier sans extension (espaces à la place de _ et -).
 */
export function loadFauxProfileLenders(): ShopFeaturedLender[] {
  const dir = path.join(process.cwd(), "public", "ressources", "faux_profils");
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const images = names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "fr"));

  return images.map((filename) => {
    const base = path.parse(filename).name;
    const safeKey = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return {
      userId: `__faux_profils__${safeKey}`,
      displayName: displayNameFromFilename(base),
      avatarUrl: `/ressources/faux_profils/${encodeURIComponent(filename)}`,
      skipMemberProfileLink: true,
    };
  });
}
