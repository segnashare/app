-- Remplace member_prospects + items.intended_prospect_id par de vrais comptes (rôle prospect) + items.intended_owner_user_id.

-- ---------------------------------------------------------------------------
-- Items : destinataire = public.users (ex. membre au rôle prospect)
-- ---------------------------------------------------------------------------

alter table public.items
  add column if not exists intended_owner_user_id uuid references public.users (id) on delete set null;

comment on column public.items.intended_owner_user_id is
  'Membre destinataire (souvent rôle prospect) pour une pièce au stock Segna ; owner_user_id reste le compte stock tant que le transfert n’est pas fait.';

-- Anciennes pièces : si le prospect avait été claim, repointer vers l’utilisateur final.
update public.items i
set intended_owner_user_id = mp.claimed_user_id
from public.member_prospects mp
where i.intended_prospect_id = mp.id
  and mp.claimed_user_id is not null;

drop index if exists public.items_intended_prospect_id_idx;

alter table public.items drop column if exists intended_prospect_id;

create index if not exists items_intended_owner_user_id_idx
  on public.items (intended_owner_user_id)
  where intended_owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- Suppression fiches sans auth + fonction de claim
-- ---------------------------------------------------------------------------

drop function if exists public.claim_member_prospect_for_new_user();

drop table if exists public.member_prospects cascade;

-- ---------------------------------------------------------------------------
-- Bootstrap : plus de claim prospect (comptes prospect = auth.users dès la création staff)
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_phone text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email, phone
  into v_email, v_phone
  from auth.users
  where id = v_uid;

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone)
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      first_name = coalesce(excluded.first_name, public.users.first_name),
      last_name = coalesce(excluded.last_name, public.users.last_name),
      locale = coalesce(excluded.locale, public.users.locale),
      timezone = coalesce(excluded.timezone, public.users.timezone);

  insert into public.user_roles (user_id, role)
  values (v_uid, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_wallets (user_id, balance)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
  on conflict (user_id) do nothing;

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;
