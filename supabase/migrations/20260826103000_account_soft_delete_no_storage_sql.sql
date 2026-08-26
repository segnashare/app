-- Fix: ne plus DELETE storage.objects (interdit) — purge via Storage API côté app.

create or replace function public.request_my_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_guard jsonb;
  v_blocked boolean := false;
  v_existing_id uuid;
  v_request_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_anon_email text;
  v_already_deleted boolean := false;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select u.deleted_at is not null
    into v_already_deleted
  from public.users u
  where u.id = v_uid;

  if not found then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_guard := public.get_my_account_deletion_guard();
  v_blocked := coalesce((v_guard ->> 'blocked')::boolean, false);
  v_anon_email := 'deleted+' || replace(v_uid::text, '-', '') || '@segna.invalid';

  select r.id
    into v_existing_id
  from public.account_deletion_requests r
  where r.user_id = v_uid
    and r.deleted_at is null
    and r.status in (
      'pending'::public.account_deletion_request_status,
      'blocked'::public.account_deletion_request_status
    )
  order by r.requested_at desc
  limit 1
  for update;

  if v_already_deleted then
    return jsonb_build_object(
      'ok', true,
      'blocked', false,
      'soft_deleted', true,
      'already_deleted', true,
      'request_id', v_existing_id,
      'guard', v_guard
    );
  end if;

  if v_blocked then
    if v_existing_id is not null then
      update public.account_deletion_requests r
      set
        status = 'blocked'::public.account_deletion_request_status,
        reason = coalesce(v_reason, r.reason),
        blocker_snapshot = coalesce(v_guard -> 'blockers', '{}'::jsonb),
        requested_at = timezone('utc', now()),
        processed_at = null,
        processed_by = null,
        notes = null,
        updated_at = timezone('utc', now())
      where r.id = v_existing_id
      returning r.id into v_request_id;
    else
      insert into public.account_deletion_requests (
        user_id,
        status,
        reason,
        blocker_snapshot
      )
      values (
        v_uid,
        'blocked'::public.account_deletion_request_status,
        v_reason,
        coalesce(v_guard -> 'blockers', '{}'::jsonb)
      )
      returning id into v_request_id;
    end if;

    return jsonb_build_object(
      'ok', false,
      'blocked', true,
      'soft_deleted', false,
      'request_id', v_request_id,
      'guard', v_guard
    );
  end if;

  update public.users u
  set
    deleted_at = timezone('utc', now()),
    deleted_by_user_id = v_uid,
    delete_reason = coalesce(v_reason, 'member_self_delete'),
    purge_after = timezone('utc', now()) + interval '6 months',
    email = v_anon_email,
    phone = null,
    first_name = null,
    last_name = null,
    birth_date = null,
    adress = null,
    updated_at = timezone('utc', now())
  where u.id = v_uid
    and u.deleted_at is null;

  update public.user_profiles p
  set
    display_name = null,
    photos = '{}'::jsonb,
    looks = '[]'::jsonb,
    answers = '{}'::jsonb,
    profile_data = '{}'::jsonb,
    city = null,
    age = null,
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where p.user_id = v_uid
    and p.deleted_at is null;

  update public.community_inspirations i
  set
    deleted_at = timezone('utc', now()),
    status = 'hidden',
    title = '',
    caption = '',
    media_paths = '[]'::jsonb,
    video_poster_path = null,
    updated_at = timezone('utc', now())
  where i.author_user_id = v_uid
    and i.deleted_at is null;

  update public.inspiration_likes l
  set
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where l.member_user_id = v_uid
    and l.deleted_at is null;

  update public.member_follows f
  set
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where (f.follower_user_id = v_uid or f.following_user_id = v_uid)
    and f.deleted_at is null;

  update public.item_favorites fav
  set deleted_at = timezone('utc', now())
  where fav.user_id = v_uid
    and fav.deleted_at is null;

  update public.device_push_tokens t
  set disabled_at = timezone('utc', now())
  where t.user_id = v_uid
    and t.disabled_at is null;

  update public.user_identity_verifications v
  set
    payload = '{}'::jsonb,
    deleted_at = coalesce(v.deleted_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where v.user_id = v_uid
    and v.deleted_at is null;

  if v_existing_id is not null then
    update public.account_deletion_requests r
    set
      status = 'completed'::public.account_deletion_request_status,
      reason = coalesce(v_reason, r.reason),
      blocker_snapshot = coalesce(v_guard -> 'blockers', '{}'::jsonb),
      requested_at = timezone('utc', now()),
      processed_at = timezone('utc', now()),
      processed_by = v_uid,
      notes = 'soft_deleted_self_serve',
      updated_at = timezone('utc', now())
    where r.id = v_existing_id
    returning r.id into v_request_id;
  else
    insert into public.account_deletion_requests (
      user_id,
      status,
      reason,
      blocker_snapshot,
      processed_at,
      processed_by,
      notes
    )
    values (
      v_uid,
      'completed'::public.account_deletion_request_status,
      v_reason,
      coalesce(v_guard -> 'blockers', '{}'::jsonb),
      timezone('utc', now()),
      v_uid,
      'soft_deleted_self_serve'
    )
    returning id into v_request_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'blocked', false,
    'soft_deleted', true,
    'already_deleted', false,
    'request_id', v_request_id,
    'guard', v_guard
  );
end;
$fn$;

comment on function public.request_my_account_deletion(text) is
  'Soft-delete self-serve : anonymise + masque looks. Médias storage purgés via Storage API app. Conserve historique commandes.';

revoke all on function public.request_my_account_deletion(text) from public;
grant execute on function public.request_my_account_deletion(text) to authenticated;
