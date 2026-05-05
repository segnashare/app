-- Blocages par téléphone avant inscription : cartouche user_blocks reliée au compte
-- lorsque public.users.phone correspond à blocked_phone_e164.

alter table public.user_blocks
  add column if not exists blocked_phone_e164 text,
  add column if not exists blocked_label text;

comment on column public.user_blocks.blocked_phone_e164 is 'E.164 (+33…) pour matcher un futur compte ; blocage effectif une fois blocked_user_id renseigné par trigger.';
comment on column public.user_blocks.blocked_label is 'Prénom / libellé saisi par le bloqueur pour l’affichage liste.';

alter table public.user_blocks
  alter column blocked_user_id drop not null;

alter table public.user_blocks
  drop constraint if exists user_blocks_has_target_chk;

alter table public.user_blocks
  add constraint user_blocks_has_target_chk
  check (
    blocked_user_id is not null
    or (blocked_phone_e164 is not null and length(trim(blocked_phone_e164)) > 0)
  );

-- Ancienne contrainte d’unicité couple (bloqueur, bloqué) si présente (noms courants Supabase).
alter table public.user_blocks drop constraint if exists user_blocks_blocked_by_user_id_blocked_user_id_key;
alter table public.user_blocks drop constraint if exists user_blocks_blocked_by_user_id_blocked_user_id_unique;

drop index if exists public.user_blocks_active_user_pair_uidx;
create unique index user_blocks_active_user_pair_uidx
  on public.user_blocks (blocked_by_user_id, blocked_user_id)
  where deleted_at is null and blocked_user_id is not null;

drop index if exists public.user_blocks_active_phone_pair_uidx;
create unique index user_blocks_active_phone_pair_uidx
  on public.user_blocks (blocked_by_user_id, blocked_phone_e164)
  where deleted_at is null and blocked_phone_e164 is not null;

-- Quand un compte reçoit un numéro identique à une cartouche en attente : rattache blocked_user_id.
create or replace function public.link_user_blocks_on_user_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := nullif(trim(coalesce(new.phone, '')), '');
  if v_phone is null then
    return new;
  end if;

  update public.user_blocks ub
  set blocked_user_id = new.id
  where ub.deleted_at is null
    and ub.blocked_user_id is null
    and ub.blocked_phone_e164 is not null
    and trim(ub.blocked_phone_e164) = v_phone
    and ub.blocked_by_user_id is distinct from new.id;

  return new;
end;
$$;

drop trigger if exists trg_users_link_user_blocks_phone on public.users;
create trigger trg_users_link_user_blocks_phone
after insert or update of phone on public.users
for each row
execute function public.link_user_blocks_on_user_phone();
