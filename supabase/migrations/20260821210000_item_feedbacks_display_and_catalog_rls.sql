-- Avis pièces : lecture catalogue + listes pour fiche item.

drop policy if exists feedbacks_select_item_catalog on public.feedbacks;
create policy feedbacks_select_item_catalog
on public.feedbacks
for select
to authenticated
using (
  deleted_at is null
  and target_type = 'item'::public.feedback_target_type
);

create or replace function public.list_item_feedbacks_for_display(p_item_id uuid)
returns table (
  id uuid,
  rating smallint,
  comment text,
  reviewer_display_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    f.rating,
    nullif(trim(f.comment), '') as comment,
    coalesce(
      nullif(trim(concat_ws(' ', u.first_name, left(nullif(trim(u.last_name), ''), 1))), ''),
      nullif(trim(up.display_name), ''),
      'Membre Segna'
    ) as reviewer_display_name,
    f.created_at
  from public.feedbacks f
  left join public.users u on u.id = f.reviewer_user_id
  left join public.user_profiles up on up.user_id = f.reviewer_user_id
  where f.deleted_at is null
    and f.target_type = 'item'::public.feedback_target_type
    and f.item_id = p_item_id
    and f.rating is not null
  order by f.created_at desc;
$$;

grant execute on function public.list_item_feedbacks_for_display(uuid) to authenticated;

create or replace function public.list_item_worn_photo_paths(p_item_id uuid)
returns table (
  feedback_id uuid,
  storage_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id as feedback_id,
    path.value::text as storage_path,
    f.created_at
  from public.feedbacks f
  cross join lateral jsonb_array_elements_text(
    coalesce(f.metadata -> 'worn_photo_paths', '[]'::jsonb)
  ) as path(value)
  where f.deleted_at is null
    and f.target_type = 'item'::public.feedback_target_type
    and f.item_id = p_item_id
    and nullif(trim(path.value::text), '') is not null
  order by f.created_at desc;
$$;

grant execute on function public.list_item_worn_photo_paths(uuid) to authenticated;

comment on function public.list_item_feedbacks_for_display(uuid) is
  'Avis publics (note + commentaire) affichés sur la fiche pièce.';
comment on function public.list_item_worn_photo_paths(uuid) is
  'Chemins storage des photos portées déposées via metadata.worn_photo_paths sur les avis item.';
