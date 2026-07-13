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
  | "onboarding_stack_image"
  /** Page abonnement SegnaX (`/package?plan=x` ou alias `plan=credits`) : textes, offre mise en avant, CTA Stripe. */
  | "subscription_plan_landing"
  /** Page cadeau de bienvenue (`/package?plan=credits` onboarding) : montant crédits offerts et textes. */
  | "welcome_gift_landing"
  /** Hero plein écran page d’accueil : logo + image + titre + lien. */
  | "home_hero";

/** Config publiée d’une section hub catalogue (titre, flèche, lien « voir plus »). */
export type CmsCatalogSectionConfig = {
  title?: string;
  /** Si true : pas de titre de section dans l’app (uniquement le contenu / frames). */
  hide_section_title?: boolean;
  show_more_arrow?: boolean;
  /** Chemin interne (ex. /shop/discover) ou URL absolue */
  more_href?: string;
  /** Filtre catalogue commun aux grandes cartes de la section (marque, matériau, …). */
  catalog_filter_kind?: string;
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
  /**
   * Carte liée à `/package?plan=credits` : visible uniquement tant que
   * `onboarding_process === "offer"` (offre spéciale onboarding).
   */
  onboarding_offer_only?: boolean;
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
  /** --- subscription_plan_landing (/package?plan=x | plan=credits) --- */
  subscription_header_wordmark?: string;
  subscription_page_title?: string;
  subscription_credits_line?: string;
  subscription_intro_body?: string;
  subscription_cta_label?: string;
  subscription_offer_badge?: string;
  subscription_offer_title?: string;
  subscription_offer_subtitle?: string;
  subscription_offer_price_detail?: string;
  subscription_micro_line?: string;
  subscription_footnote?: string;
  subscription_value_props?: { title: string; body: string }[];
  /** `segna_x` (défaut) ou `segna_plus` pour le checkout Stripe (repli si un palier n’a pas son propre code). */
  subscription_checkout_plan_code?: string;
  /** Titre hero sous l’en-tête (sauts de ligne `\n` possibles). */
  subscription_hero_title?: string;
  /** Image hero (même schéma Storage que les autres refs CMS). */
  subscription_hero_image?: CmsImageRef | null;
  /**
   * Paliers d’offre (scroll horizontal). Champs optionnels : seuls les renseignés s’affichent.
   * `featured` : carte mise en avant (style barre noire).
   * Layout « promo » : si `promo_avg_price` + `promo_detail_bold` sont renseignés,
   * la carte affiche en gros le prix moyen puis le détail gris (ex. « 1 mois offert » en gras + reste).
   * `promo_discount_pct` est ignoré en UI (non affiché).
   */
  subscription_offer_tiers?: {
    badge?: string;
    title?: string;
    subtitle?: string;
    price_line?: string;
    micro_line?: string;
    featured?: boolean;
    checkout_plan_code?: string;
    promo_avg_price?: string;
    promo_discount_pct?: number | string;
    promo_detail_bold?: string;
    promo_detail_rest?: string;
    /** Libellé bouton principal (ex. « Profite de 3 mois pour 99,99 € »). */
    synthetic_checkout_cta?: string;
    /** Si renseigné (ex. 30) : période d’essai Stripe pour ce palier (`subscription_data.trial_period_days`). */
    trial_period_days?: number | string;
  }[];
  /** --- welcome_gift_landing (section `offer_welcome_gift`) --- */
  welcome_gift_page_title?: string;
  welcome_gift_card_badge?: string;
  welcome_gift_credits_amount?: number | string;
  welcome_gift_card_subtitle?: string;
  welcome_gift_intro_body?: string;
  welcome_gift_cta_label?: string;
  welcome_gift_card_cta_label?: string;
  welcome_gift_activate_cta_label?: string;
  welcome_gift_footnote?: string;
  welcome_gift_value_props?: { title?: string; body?: string }[];
};

export type CmsFrameRow = {
  id: string;
  frame_type: CmsFrameType;
  sort_order: number;
  plan_code: CmsPlanCode;
  payload: CmsFramePayload;
};
