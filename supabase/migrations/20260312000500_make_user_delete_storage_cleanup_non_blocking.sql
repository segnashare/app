-- Keep user deletion non-blocking when storage cleanup cannot be done via SQL.
-- Supabase Storage can reject direct DELETE on storage.objects.

create or replace function public.delete_user_storage_folder_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from storage.objects
    where bucket_id = 'bucket_focus'
      and name like format('users/%s/%%', old.id::text);
  exception
    when others then
      raise log 'Skipping storage cleanup for user %: %', old.id, sqlerrm;
  end;

  return old;
end;
$$;
