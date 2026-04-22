-- Visuels CMS (bucket_cms_app) : lecture pour JWT anon afin que /auth puisse
-- résoudre des URLs signées (createSignedUrl) sans session.
-- Avant : seule la policy « authenticated » existait → 400 pour les invités.

drop policy if exists "bucket_cms_app_select_anon" on storage.objects;

create policy "bucket_cms_app_select_anon"
on storage.objects
for select
to anon
using (bucket_id = 'bucket_cms_app');

comment on policy "bucket_cms_app_select_anon" on storage.objects is
  'Select sur les objets CMS pour collage /auth et autres écrans publics (URL signée côté client anon).';
