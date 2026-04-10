import type { CmsCatalogSectionConfig } from "@/lib/cms/cms-types";

/** Clés `section_key` en base + identifiants stables côté app. */
export const SHOP_HUB_SECTION_KEYS = {
  discover: "shop_section_discover",
  categories: "shop_section_categories",
  preferredBrands: "shop_section_preferred_brands",
  deals: "shop_section_deals",
  french: "shop_section_french",
} as const;

export type ShopHubSectionSlug = keyof typeof SHOP_HUB_SECTION_KEYS;

/** Valeurs par défaut si la config CMS est vide ou RPC absente. */
export const SHOP_HUB_DEFAULT_CONFIG: Record<ShopHubSectionSlug, Required<CmsCatalogSectionConfig>> = {
  discover: {
    title: "À découvrir sur Segna",
    hide_section_title: false,
    show_more_arrow: true,
    more_href: "/shop/discover",
    visible_plan_codes: [],
  },
  categories: {
    title: "Catégories",
    hide_section_title: false,
    show_more_arrow: false,
    more_href: "",
    visible_plan_codes: [],
  },
  preferredBrands: {
    title: "Vos marques préférées",
    hide_section_title: false,
    show_more_arrow: true,
    more_href: "/shop/preferred-brands",
    visible_plan_codes: [],
  },
  deals: {
    title: "Les bons coups",
    hide_section_title: false,
    show_more_arrow: true,
    more_href: "/shop/deals",
    visible_plan_codes: [],
  },
  french: {
    title: "Mode à la française",
    hide_section_title: false,
    show_more_arrow: true,
    more_href: "/shop/french",
    visible_plan_codes: [],
  },
};

export function mergeShopHubSectionDisplay(
  slug: ShopHubSectionSlug,
  config: CmsCatalogSectionConfig | null | undefined,
): Required<CmsCatalogSectionConfig> {
  const d = SHOP_HUB_DEFAULT_CONFIG[slug];
  const c = config ?? {};
  const vpc =
    Array.isArray(c.visible_plan_codes) && c.visible_plan_codes.length > 0 ? c.visible_plan_codes : d.visible_plan_codes;
  return {
    title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : d.title,
    hide_section_title: c.hide_section_title === true,
    more_href: typeof c.more_href === "string" ? c.more_href : d.more_href,
    show_more_arrow: typeof c.show_more_arrow === "boolean" ? c.show_more_arrow : d.show_more_arrow,
    visible_plan_codes: vpc ?? [],
  };
}
