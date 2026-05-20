-- Nouvelle phase expédition : retirer étiquettes legacy (Mondial Relay / Sendcloud) pour forcer une étiquette fraîche.

create or replace function public.item_intake_metadata_strip_shipping_labels(p_meta jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_sc jsonb;
begin
  v_meta := v_meta - 'mondial_relay';
  if v_meta ? 'sendcloud' and jsonb_typeof(v_meta -> 'sendcloud') = 'object' then
    v_sc :=
      (v_meta -> 'sendcloud')
        - 'label_url'
        - 'numero_suivi'
        - 'lien_suivi'
        - 'reference_expedition'
        - 'sc_merge_item_ids'
        - 'last_member_sc_error_at'
        - 'last_member_sc_error_message'
        - 'sc_member_help_requested_at'
        - 'sc_member_incident_note';
    if v_sc = '{}'::jsonb then
      v_meta := v_meta - 'sendcloud';
    else
      v_meta := jsonb_set(v_meta, '{sendcloud}', v_sc, true);
    end if;
  end if;
  return v_meta;
end;
$$;

comment on function public.item_intake_metadata_strip_shipping_labels(jsonb) is
  'Retire mondial_relay et les champs d’étiquette Sendcloud d’un metadata item_intake.';

create or replace function public.item_intake_before_update_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated'
     and new.fulfillment_stage is distinct from old.fulfillment_stage
  then
    raise exception 'item_intake.fulfillment_stage: mise a jour reservee au service role';
  end if;

  if new.listing_stage::text = 'validated'
     and old.listing_stage::text = 'validation_pending'
     and new.fulfillment_stage is null
  then
    new.fulfillment_stage := 'shipping'::public.item_intake_fulfillment_stage;
  end if;

  if new.fulfillment_stage::text = 'shipping'
     and coalesce(old.fulfillment_stage::text, '') is distinct from 'shipping'
  then
    new.metadata := public.item_intake_metadata_strip_shipping_labels(new.metadata);
  end if;

  return new;
end;
$$;
