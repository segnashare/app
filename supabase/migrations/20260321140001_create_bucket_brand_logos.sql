-- Bucket public pour les logos des marques (SVG)
insert into storage.buckets (id, name, public)
values ('brand_logos', 'brand_logos', true)
on conflict (id) do nothing;

-- Lecture publique (logos accessibles sans auth)
drop policy if exists "brand_logos_select_public" on storage.objects;
create policy "brand_logos_select_public"
  on storage.objects
  for select
  to public
  using (bucket_id = 'brand_logos');

-- Upload réservé aux admins/service (à adapter selon ta config)
drop policy if exists "brand_logos_insert_authenticated" on storage.objects;
create policy "brand_logos_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'brand_logos');
