-- Au plus une ligne owner_announced par pièce (évite les doublons créés par des appels répétés).
delete from public.item_condition_history h
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by item_id
        order by recorded_at desc nulls last, created_at desc nulls last, id desc
      ) as rn
    from public.item_condition_history
    where source = 'owner_announced'
  ) ranked
  where ranked.rn > 1
) d
where h.id = d.id;

create unique index if not exists idx_item_condition_history_owner_announced_unique
  on public.item_condition_history (item_id)
  where source = 'owner_announced';

comment on index public.idx_item_condition_history_owner_announced_unique is
  'Une seule entrée owner_announced par item (état initial membre)';
