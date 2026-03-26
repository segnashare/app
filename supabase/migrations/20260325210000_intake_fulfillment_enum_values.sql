-- Nouvelles valeurs enum (transaction separee : PG refuse d'utiliser une nouvelle valeur enum dans la meme transaction que ADD VALUE)

do $e$
begin
  alter type public.item_intake_fulfillment_stage add value 'shipping';
exception
  when duplicate_object then null;
end $e$;

do $e$
begin
  alter type public.item_intake_fulfillment_stage add value 'in_verification';
exception
  when duplicate_object then null;
end $e$;
