alter table public.items
  add column if not exists photos jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'item_media'
  ) then
    with ranked_media as (
      select
        im.item_id,
        im.media_url,
        im.display_order,
        im.is_cover,
        row_number() over (
          partition by im.item_id
          order by coalesce(im.display_order, 9999), im.created_at, im.id
        ) as rn
      from public.item_media im
      where im.deleted_at is null
    ),
    photos_payload as (
      select
        rm.item_id,
        jsonb_object_agg(
          'photo' || rm.rn::text,
          jsonb_build_object(
            'url', rm.media_url,
            'storage_path', rm.media_url,
            'position', jsonb_build_object(
              'offset', jsonb_build_object('x', 0, 'y', 0),
              'zoom', 1,
              'aspect', 'square'
            ),
            'is_cover', coalesce(rm.is_cover, false),
            'display_order', coalesce(rm.display_order, rm.rn)
          )
        ) as photos
      from ranked_media rm
      group by rm.item_id
    )
    update public.items i
       set photos = coalesce(pp.photos, '{}'::jsonb)
      from photos_payload pp
     where i.id = pp.item_id;

    drop table public.item_media cascade;
  end if;
end $$;
