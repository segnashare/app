-- Après suppression de la valeur super_admin sur l'enum app_role, toute politique RLS
-- encore exprimée avec le littéral 'super_admin' provoque à l'exécution :
--   invalid input value for enum app_role: "super_admin"
-- (visible dans les logs Postgres au moment du login /token Auth).
--
-- Recrée les policies item_condition_history côté staff sans ce littéral (idempotent).

do $$
begin
  if to_regclass('public.item_condition_history') is not null then
    execute 'drop policy if exists item_condition_history_select_via_staff on public.item_condition_history';
    execute 'drop policy if exists item_condition_history_insert_via_staff on public.item_condition_history';
    execute $pol$
      create policy item_condition_history_select_via_staff
        on public.item_condition_history for select
        to authenticated
        using (
          exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.role in ('moderator'::public.app_role, 'admin'::public.app_role)
              and ur.deleted_at is null
          )
        );
    $pol$;
    execute $pol$
      create policy item_condition_history_insert_via_staff
        on public.item_condition_history for insert
        to authenticated
        with check (
          exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.role in ('moderator'::public.app_role, 'admin'::public.app_role)
              and ur.deleted_at is null
          )
        );
    $pol$;
  end if;
end;
$$;
