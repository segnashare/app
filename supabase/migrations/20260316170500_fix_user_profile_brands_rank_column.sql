do $$
declare
  has_brand_item_id boolean;
  has_brand_id boolean;
begin
  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profile_brands'
      and column_name = 'brand_item_id'
  ) into has_brand_item_id;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profile_brands'
      and column_name = 'brand_id'
  ) into has_brand_id;

  if has_brand_item_id and not has_brand_id then
    execute 'alter table public.user_profile_brands rename column brand_item_id to brand_id';
  end if;
end
$$;

alter table public.user_profile_brands
  add column if not exists rank smallint;

with duplicated as (
  select
    id,
    row_number() over (
      partition by user_profile_id, brand_id
      order by created_at asc, id asc
    ) as rn
  from public.user_profile_brands
)
delete from public.user_profile_brands upb
using duplicated d
where upb.id = d.id
  and d.rn > 1;

with ordered as (
  select
    id,
    row_number() over (
      partition by user_profile_id
      order by
        case when rank is null or rank < 1 then 32767 else rank end asc,
        created_at asc,
        id asc
    )::smallint as next_rank
  from public.user_profile_brands
)
update public.user_profile_brands upb
set rank = ordered.next_rank
from ordered
where upb.id = ordered.id
  and upb.rank is distinct from ordered.next_rank;

alter table public.user_profile_brands
  alter column rank set not null;

create unique index if not exists user_profile_brands_user_profile_id_brand_id_uidx
  on public.user_profile_brands (user_profile_id, brand_id);

create unique index if not exists user_profile_brands_user_profile_id_rank_uidx
  on public.user_profile_brands (user_profile_id, rank);
