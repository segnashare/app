create or replace function public.set_user_phone_verified(
  p_phone_e164 text,
  p_request_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_phone text;
  v_row public.users;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_phone := nullif(trim(p_phone_e164), '');
  if v_phone is null then
    raise exception 'Phone is required';
  end if;

  insert into public.users (id, phone)
  values (v_uid, v_phone)
  on conflict (id) do update
  set phone = excluded.phone
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'set_user_phone_verified',
    p_payload => jsonb_build_object('phone', v_phone),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

grant execute on function public.set_user_phone_verified(text, uuid) to authenticated;
