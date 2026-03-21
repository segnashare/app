alter table public.xp_badges
  add column if not exists icon text;

update public.xp_badges
set icon = case badge_code
  when 'xp_badge_premiere_sortie' then '🎈'
  when 'xp_badge_segnaversaire' then '🎂'
  when 'xp_badge_toujours_la' then '🗓️'
  when 'xp_badge_100_echanges' then '🔁'
  when 'xp_badge_globe_segna' then '🧭'
  when 'xp_badge_premiere_piece' then '📦'
  when 'xp_badge_garde_robe_soignee' then '🧵'
  when 'xp_badge_capsule_pro' then '💼'
  when 'xp_badge_queen_accessoires' then '👒'
  when 'xp_badge_big_value' then '💰'
  when 'xp_badge_style_maker' then '📸'
  when 'xp_badge_reel_queen' then '🎥'
  when 'xp_badge_cura_crew' then '🗳️'
  when 'xp_badge_conseillere' then '🗣️'
  when 'xp_badge_party_girl' then '🎊'
  when 'xp_badge_amie_invitee' then '🎀'
  when 'xp_badge_clique_segna' then '👭'
  when 'xp_badge_confiance_exemplaire' then '🔐'
  when 'xp_badge_toujours_repond' then '✉️'
  when 'xp_badge_all_star_mois' then '🏅'
  else icon
end;
