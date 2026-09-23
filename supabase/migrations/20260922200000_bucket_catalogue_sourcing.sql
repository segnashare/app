-- Miroir cloud des dossiers Finder « À cataloguer » / « Catalogué » (BO sourcing prod).
insert into storage.buckets (id, name, public)
values ('bucket_catalogue_sourcing', 'bucket_catalogue_sourcing', false)
on conflict (id) do nothing;

drop policy if exists bucket_catalogue_sourcing_select_service on storage.objects;
create policy bucket_catalogue_sourcing_select_service
on storage.objects for select to service_role
using (bucket_id = 'bucket_catalogue_sourcing');

drop policy if exists bucket_catalogue_sourcing_insert_service on storage.objects;
create policy bucket_catalogue_sourcing_insert_service
on storage.objects for insert to service_role
with check (bucket_id = 'bucket_catalogue_sourcing');

drop policy if exists bucket_catalogue_sourcing_update_service on storage.objects;
create policy bucket_catalogue_sourcing_update_service
on storage.objects for update to service_role
using (bucket_id = 'bucket_catalogue_sourcing')
with check (bucket_id = 'bucket_catalogue_sourcing');

drop policy if exists bucket_catalogue_sourcing_delete_service on storage.objects;
create policy bucket_catalogue_sourcing_delete_service
on storage.objects for delete to service_role
using (bucket_id = 'bucket_catalogue_sourcing');
