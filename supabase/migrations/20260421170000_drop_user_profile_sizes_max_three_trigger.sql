-- Ancien garde-fou : max 3 lignes au total sur user_profile_sizes (incompatible multi-tailles par catégorie).

drop trigger if exists trg_max_three_sizes on public.user_profile_sizes;

drop function if exists public.check_max_three_sizes();
