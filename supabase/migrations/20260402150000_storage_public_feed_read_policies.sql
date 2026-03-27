-- Allow authenticated members to read media shown in public feed cards.
-- Without these policies, signing URLs for other members' items/profiles fails (400).

drop policy if exists bucket_items_select_authenticated_feed_read on storage.objects;
create policy bucket_items_select_authenticated_feed_read
on storage.objects
for select
to authenticated
using (bucket_id = 'bucket_items');

drop policy if exists bucket_focus_select_authenticated_feed_read on storage.objects;
create policy bucket_focus_select_authenticated_feed_read
on storage.objects
for select
to authenticated
using (bucket_id = 'bucket_focus');

