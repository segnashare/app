-- Type de frame « hero » pour l’onglet profil Obtenir plus (image + texte centré + CTA).

alter table public.cms_app_section_frames
  drop constraint if exists cms_app_section_frames_type_check;

alter table public.cms_app_section_frames
  add constraint cms_app_section_frames_type_check check (
    frame_type in (
      'offer_card',
      'category_capsule',
      'promo_ad',
      'editorial_card',
      'shop_item_ref',
      'shop_category_ref',
      'shop_brand_ref',
      'shop_link_card',
      'profile_plus_hero'
    )
  );
