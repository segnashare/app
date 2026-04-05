-- Libellés : un seul « bloc promo » = Panier (offres) + Échange (mise en avant).

update public.cms_app_sections
set display_title = 'Bloc promo · Panier — Des offres pour vous'
where section_key = 'cart_offers';

update public.cms_app_sections
set display_title = 'Bloc promo · Échange — mise en avant'
where section_key = 'commerce_promo_ad';
