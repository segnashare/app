-- Horodate le passage en listing evaluation pour le décompte 24h côté app (metadata.evaluation_started_at).

create or replace function public.item_intake_touch_evaluation_started_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_stage::text = 'evaluation' then
    if tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and old.listing_stage::text is distinct from 'evaluation')
    then
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'evaluation_started_at',
        to_jsonb(now()::text)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_item_intake_touch_evaluation_started_at on public.item_intake;
create trigger trg_item_intake_touch_evaluation_started_at
before insert or update of listing_stage on public.item_intake
for each row
execute function public.item_intake_touch_evaluation_started_at();

-- Lignes déjà en evaluation sans horodatage : meilleure approximation = updated_at
update public.item_intake
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evaluation_started_at',
  to_jsonb(updated_at::text)
)
where listing_stage::text = 'evaluation'
  and coalesce(metadata->>'evaluation_started_at', '') = '';

comment on function public.item_intake_touch_evaluation_started_at() is
  'Enregistre metadata.evaluation_started_at au passage en listing evaluation (décompte 24h membre).';
