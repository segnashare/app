do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'item_outtake_stage'
      and e.enumlabel = 'member_verification_pending'
  ) then
    alter type public.item_outtake_stage add value 'member_verification_pending';
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'item_outtake_stage'
      and e.enumlabel = 'member_issue_reported'
  ) then
    alter type public.item_outtake_stage add value 'member_issue_reported';
  end if;
end $$;
