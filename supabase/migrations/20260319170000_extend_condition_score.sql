-- Étendre condition_score pour distinguer les 4 options UI :
-- Neuf avec étiquette, Excellent état, Très bon état, Bon état
-- (au lieu de 2 scores : excellent, bon)
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on con.conrelid = rel.oid
  where rel.relname = 'item_condition_history'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%condition_score%'
  limit 1;
  if cname is not null then
    execute format('alter table public.item_condition_history drop constraint %I', cname);
  end if;
end $$;

alter table public.item_condition_history
  add constraint item_condition_history_condition_score_check
  check (condition_score in (
    'neuf_etiquette',  -- Neuf avec étiquette
    'excellent',      -- Excellent état
    'tres_bon',       -- Très bon état
    'bon',            -- Bon état
    'acceptable',
    'degrade'
  ));

comment on column public.item_condition_history.condition_score is
  'neuf_etiquette | excellent | tres_bon | bon | acceptable | degrade';
