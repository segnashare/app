export type CmsPhotoPosition = {
  offset?: { x?: number; y?: number };
  zoom?: number;
  /** ex. `wide` (grande carte), `profile_plus_hero` (500×350), `square`, `shop_split_right` */
  aspect?: string;
} | null;

export type CmsPlanCode = "guest" | "segna_plus" | "segna_x";

export type CmsFrameType =
  | "offer_card"
  | "category_capsule"
  | "promo_ad"
  | "editorial_card"
  | "shop_item_ref"
  | "shop_category_ref"
  | "shop_brand_ref"
  | "shop_link_card"
  /** Hero plein largeur (profil — Obtenir plus) : label + titre + sous-titre + CTA sur image. */
  | "profile_plus_hero"
  /** Image collage écran d’accueil /auth (BO : page Auth). */
  | "auth_collage_image"
  /** Pile visuelle onboarding (BO : page Onboarding) — même payload collage, rendu vertical sans flottement. */
  | "onboarding_stack_image";

/** Config publiée d’une section hub catalogue (titre, flèche, lien « voir plus »). */
export type CmsCatalogSectionConfig = {
  title?: string;
  /** Si true : pas de titre de section dans l’app (uniquement le contenu / frames). */
  hide_section_title?: boolean;
  show_more_arrow?: boolean;
  /** Chemin interne (ex. /shop/discover) ou URL absolue */
  more_href?: string;
  /** Si non vide : seuls ces plans voient la section (sinon tous). Renseigné côté serveur / BO. */
  visible_plan_codes?: CmsPlanCode[];
};

export type CmsBackgroundKind = "none" | "gradient" | "solid" | "image";

export type CmsImageRef = {
  storage_path: string;
  /** Rempli côté serveur après signature Storage */
  signed_url?: string;
  position?: CmsPhotoPosition;
};

export type CmsBackgroundPayload = {
  kind: CmsBackgroundKind;
  /** Classes Tailwind pour dégradé, ex. from-amber-100 to-orange-50 */
  gradient_classes?: string;
  solid_hex?: string;
  image?: CmsImageRef;
};

/** Grande carte lien & cartes pièce CMS : couleur du texte sur fond coloré. */
export type CmsLinkCardTitleColor = "white" | "black";

export type CmsFramePayload = {
  /**
   * Titre d’affichage. Grande carte hub (`shop_link_card`) : sauts de ligne (`\n`) affichés tels quels.
   * Section `segna_stock_property` : `{{segna_mods}}` (points) et `{{segna_taille}}` sur la fiche stock Segna.
   */
  title?: string;
  /** Grande carte hub (`shop_link_card`) : blanc ou noir. */
  title_color?: CmsLinkCardTitleColor;
  subtitle?: string;
  body?: string;
  label?: string;
  header?: string;
  /** Grande carte : libellé du bouton CTA ; portions en gras avec la syntaxe `**texte**`. */
  cta_label?: string;
  /**
   * Grande carte hub (`shop_link_card`) et hero profil (`profile_plus_hero`) : pastille CTA (`cta_label`).
   */
  cta_pill?: boolean;
  button_label?: string;
  target_url?: string;
  background?: CmsBackgroundPayload;
  /** Image encadrée (carte split) */
  inset_image?: CmsImageRef & { placement?: "right" | "bottom" | "left" };
  /** Référence pièce (hub catalogue) */
  item_id?: string;
  /**
   * Mise en avant visuelle (sections CMS type À découvrir / bons coups / À la une).
   * Hex #RRGGBB ; si absent ou invalide → carte auto (couleur dérivée de l’id pièce).
   */
  item_spotlight_bg_hex?: string;
  /** Texte + pictos sur le panneau coloré : blanc ou noir. */
  item_spotlight_text_color?: CmsLinkCardTitleColor;
  /**
   * Photo du panneau droit (carte split), indépendante des photos de la fiche pièce.
   * `signed_url` ajouté côté serveur après résolution Storage.
   */
  item_spotlight_image?: CmsImageRef;
  /** Référence catégorie */
  category_id?: string;
  /** Référence marque */
  brand_id?: string;
  /** Collage écran /auth (`auth_collage_image`) */
  collage_image?: CmsImageRef | null;
  collage_aspect?: string;
  collage_size?: string;
  collage_top_pct?: number;
  collage_left_pct?: number;
  collage_float_delay_ms?: number;
  /**
   * Onboarding 3 (carrousel horizontal) : couleur de fond plein écran quand cette image est au centre.
   * Hex `#RRGGBB` ou `RRGGBB` ; si absent → blanc.
   */
  slide_background_hex?: string;
};

export type CmsFrameRow = {
  id: string;
  frame_type: CmsFrameType;
  sort_order: number;
  plan_code: CmsPlanCode;
  payload: CmsFramePayload;
};
