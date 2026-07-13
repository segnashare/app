-- Taille unique pour hauts et bas (back office + matching emprunt sans profil membre).
insert into public.sizes (code, label)
values
  ('top:TU', 'Taille unique'),
  ('bottom:TU', 'Taille unique')
on conflict (code) do nothing;
