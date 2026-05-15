-- Visuels CMS (bucket_cms_app) : lecture pour JWT anon afin que /auth puisse
-- résoudre des URLs signées (createSignedUrl) sans session.
-- Avant : seule la policy « authenticated » existait → 400 pour les invités.

drop policy if exists "bucket_cms_app_select_anon" on storage.objects;

create policy "bucket_cms_app_select_anon"
on storage.objects
for select
to anon
using (bucket_id = 'bucket_cms_app');

-- Pas de COMMENT ON POLICY ici : sur projet distant le rôle de migration n’est pas owner de storage.objects (42501).
