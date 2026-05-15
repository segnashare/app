-- Liste des blocages avec coordonnées du membre bloqué (email / téléphone) pour l’écran « Bloquées ».
-- public.users n’est pas lisible pour les autres membres via RLS : lecture dédiée au bloqueur uniquement.

create or replace function public.list_my_user_blocks_v1()
returns table (
  id uuid,
  blocked_user_id uuid,
  blocked_phone_e164 text,
  blocked_label text,
  line_title text,
  member_email text,
  member_phone_e164 text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ub.id,
    ub.blocked_user_id,
    ub.blocked_phone_e164,
    ub.blocked_label,
    coalesce(
      nullif(trim(up.display_name), ''),
      nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
      nullif(trim(ub.blocked_label), ''),
      'Membre Segna'
    )::text as line_title,
    case
      when ub.blocked_user_id is not null then nullif(trim(u.email), '')
      else null
    end::text as member_email,
    nullif(
      trim(coalesce(nullif(trim(u.phone), ''), nullif(trim(ub.blocked_phone_e164), ''))),
      ''
    )::text as member_phone_e164
  from public.user_blocks ub
  left join public.users u
    on u.id = ub.blocked_user_id
  left join public.user_profiles up
    on up.user_id = ub.blocked_user_id
  where ub.blocked_by_user_id = auth.uid()
    and ub.deleted_at is null;
$$;

comment on function public.list_my_user_blocks_v1() is
  'Lignes user_blocks actives du membre connecté avec email/téléphone cible (pour écran liste de blocage).';

revoke all on function public.list_my_user_blocks_v1() from public;
grant execute on function public.list_my_user_blocks_v1() to authenticated;
