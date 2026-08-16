-- Tutoiement : titres / libellés CMS encore en vouvoiement (hub, panier, package).

update public.cms_app_sections
set display_title = replace(display_title, 'Vos marques préférées', 'Tes marques préférées')
where display_title like '%Vos marques préférées%';

update public.cms_app_sections
set display_title = replace(display_title, 'Des offres pour vous', 'Des offres pour toi')
where display_title like '%Des offres pour vous%';

update public.cms_app_sections
set display_title = replace(display_title, 'Complétez votre tenue', 'Complète ta tenue')
where display_title like '%Complétez votre tenue%';

-- Payloads section (draft + published) : title fields
update public.cms_app_section_frames f
set
  draft_payload = case
    when f.draft_payload is null then null
    else replace(
      replace(
        replace(
          replace(f.draft_payload::text, 'Vos marques préférées', 'Tes marques préférées'),
          'Des offres pour vous',
          'Des offres pour toi'
        ),
        'Devenez membre',
        'Deviens membre'
      ),
      'Accédez jusqu',
      'Accède jusqu'
    )::jsonb
  end,
  published_payload = case
    when f.published_payload is null then null
    else replace(
      replace(
        replace(
          replace(f.published_payload::text, 'Vos marques préférées', 'Tes marques préférées'),
          'Des offres pour vous',
          'Des offres pour toi'
        ),
        'Devenez membre',
        'Deviens membre'
      ),
      'Accédez jusqu',
      'Accède jusqu'
    )::jsonb
  end
where
  (f.draft_payload::text like '%Vos marques préférées%'
    or f.draft_payload::text like '%Des offres pour vous%'
    or f.draft_payload::text like '%Devenez membre%'
    or f.draft_payload::text like '%Accédez jusqu%')
  or (f.published_payload::text like '%Vos marques préférées%'
    or f.published_payload::text like '%Des offres pour vous%'
    or f.published_payload::text like '%Devenez membre%'
    or f.published_payload::text like '%Accédez jusqu%');
