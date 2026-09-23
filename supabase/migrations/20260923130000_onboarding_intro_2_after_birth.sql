-- Intro 2 se place après la naissance, avant les tailles.
-- Les sessions encore sur /onboarding/2 sans date de naissance
-- (ancien ordre : nom → intro 2 → naissance) reprennent à la naissance.
update public.onboarding_sessions s
set current_step = '/onboarding/birth'
where s.status is distinct from 'completed'
  and s.current_step = '/onboarding/2'
  and exists (
    select 1
    from public.users u
    where u.id = s.user_id
      and u.birth_date is null
  );
