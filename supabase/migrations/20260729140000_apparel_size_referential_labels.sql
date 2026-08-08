-- Référentiel tailles vêtements (lettre / FR / US) : libellés agrégés top↔ bottom
-- + tailles manquantes (XXXS, XXXL, 4XL… / 30, 50, 52).

insert into public.sizes (code, label)
values
  ('top:XXXS', 'XXXS / 30 / 2'),
  ('top:XXS', 'XXS / 32 / 4'),
  ('top:XS', 'XS / 34 / 6'),
  ('top:S', 'S / 36 / 8'),
  ('top:M', 'M / 38 / 10'),
  ('top:L', 'L / 40 / 12'),
  ('top:XL', 'XL / 42 / 14'),
  ('top:XXL', 'XXL / 44 / 16'),
  ('top:XXXL', 'XXXL / 46 / 18'),
  ('top:4XL', '4XL / 48 / 20'),
  ('top:5XL', '5XL / 50 / 22'),
  ('top:6XL', '6XL / 52 / 24'),
  ('bottom:30', 'XXXS / 30 / 2'),
  ('bottom:32', 'XXS / 32 / 4'),
  ('bottom:34', 'XS / 34 / 6'),
  ('bottom:36', 'S / 36 / 8'),
  ('bottom:38', 'M / 38 / 10'),
  ('bottom:40', 'L / 40 / 12'),
  ('bottom:42', 'XL / 42 / 14'),
  ('bottom:44', 'XXL / 44 / 16'),
  ('bottom:46', 'XXXL / 46 / 18'),
  ('bottom:48', '4XL / 48 / 20'),
  ('bottom:50', '5XL / 50 / 22'),
  ('bottom:52', '6XL / 52 / 24')
on conflict (code) do update
set label = excluded.label;

-- Garder TU inchangé (déjà présent).
update public.sizes
set label = 'Taille unique'
where code in ('top:TU', 'bottom:TU')
  and coalesce(label, '') <> 'Taille unique';
