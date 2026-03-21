insert into storage.buckets (id, name, public)
values ('bucket_items', 'bucket_items', false)
on conflict (id) do nothing;

drop policy if exists "bucket_items_insert_own_item_objects" on storage.objects;
create policy "bucket_items_insert_own_item_objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bucket_items'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'items'
  );

drop policy if exists "bucket_items_select_own_item_objects" on storage.objects;
create policy "bucket_items_select_own_item_objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bucket_items'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'items'
  );

drop policy if exists "bucket_items_update_own_item_objects" on storage.objects;
create policy "bucket_items_update_own_item_objects"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'bucket_items'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'items'
  )
  with check (
    bucket_id = 'bucket_items'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'items'
  );

drop policy if exists "bucket_items_delete_own_item_objects" on storage.objects;
create policy "bucket_items_delete_own_item_objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'bucket_items'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'items'
  );
