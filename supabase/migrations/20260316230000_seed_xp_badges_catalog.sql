insert into public.xp_badges (badge_code, label, description, xp_bonus, is_active, metadata)
values
  (
    'xp_badge_premiere_sortie',
    'Premiere Sortie',
    '1er emprunt complete.',
    25,
    true,
    jsonb_build_object('category', 'fidelite', 'metric', 'borrow_completed_count', 'threshold', 1)
  ),
  (
    'xp_badge_segnaversaire',
    'Segnaversaire',
    '1 an de membership.',
    40,
    true,
    jsonb_build_object('category', 'fidelite', 'metric', 'membership_age_months', 'threshold', 12)
  ),
  (
    'xp_badge_toujours_la',
    'Toujours La',
    '24 mois de membership avec au moins 1 action par trimestre.',
    80,
    true,
    jsonb_build_object('category', 'fidelite', 'metric', 'membership_quarter_activity', 'threshold', 24)
  ),
  (
    'xp_badge_100_echanges',
    '100 Echanges',
    '100 echanges completes (prets + emprunts).',
    120,
    true,
    jsonb_build_object('category', 'fidelite', 'metric', 'exchange_completed_count', 'threshold', 100)
  ),
  (
    'xp_badge_globe_segna',
    'Globe-Segna',
    'A emprunte des pieces dans 5 arrondissements/quartiers differents.',
    60,
    true,
    jsonb_build_object('category', 'fidelite', 'metric', 'distinct_borrow_areas_count', 'threshold', 5)
  ),
  (
    'xp_badge_premiere_piece',
    'Premiere Piece',
    '1ere piece confiee au dressing.',
    20,
    true,
    jsonb_build_object('category', 'supply', 'metric', 'items_lent_count', 'threshold', 1)
  ),
  (
    'xp_badge_garde_robe_soignee',
    'Garde-Robe Soignee',
    '10 avis consecutifs >= 4 etoiles sur ses pieces.',
    90,
    true,
    jsonb_build_object('category', 'supply', 'metric', 'consecutive_reviews_ge_4', 'threshold', 10)
  ),
  (
    'xp_badge_capsule_pro',
    'Capsule Pro',
    '5 pieces workwear pretees.',
    45,
    true,
    jsonb_build_object('category', 'supply', 'metric', 'workwear_items_lent_count', 'threshold', 5)
  ),
  (
    'xp_badge_queen_accessoires',
    'Queen des Accessoires',
    '10 accessoires pretes.',
    45,
    true,
    jsonb_build_object('category', 'supply', 'metric', 'accessories_lent_count', 'threshold', 10)
  ),
  (
    'xp_badge_big_value',
    'Big Value',
    'Au moins 3000 EUR de valeur cumulee confiee au dressing.',
    100,
    true,
    jsonb_build_object('category', 'supply', 'metric', 'lent_catalog_value_eur', 'threshold', 3000)
  ),
  (
    'xp_badge_style_maker',
    'Style Maker',
    '10 looks postes dans le feed.',
    50,
    true,
    jsonb_build_object('category', 'community', 'metric', 'looks_posted_count', 'threshold', 10)
  ),
  (
    'xp_badge_reel_queen',
    'Reel Queen',
    '3 reels/TikTok Segna partages et valides par l''equipe.',
    70,
    true,
    jsonb_build_object('category', 'community', 'metric', 'external_reels_validated_count', 'threshold', 3)
  ),
  (
    'xp_badge_cura_crew',
    'Cura-Crew',
    '20 votes dans des sondages de curation.',
    35,
    true,
    jsonb_build_object('category', 'community', 'metric', 'curation_votes_count', 'threshold', 20)
  ),
  (
    'xp_badge_conseillere',
    'Conseillere',
    '10 reponses utiles aux questions d''autres membres.',
    40,
    true,
    jsonb_build_object('category', 'community', 'metric', 'helpful_answers_count', 'threshold', 10)
  ),
  (
    'xp_badge_party_girl',
    'Party Girl',
    'Participation a 3 evenements Segna physiques.',
    60,
    true,
    jsonb_build_object('category', 'community', 'metric', 'events_attended_count', 'threshold', 3)
  ),
  (
    'xp_badge_amie_invitee',
    'Amie Invitee',
    'A parraine 1 nouvelle membre active.',
    80,
    true,
    jsonb_build_object('category', 'trust', 'metric', 'active_referrals_count', 'threshold', 1)
  ),
  (
    'xp_badge_clique_segna',
    'Clique Segna',
    '5 filleules actives.',
    180,
    true,
    jsonb_build_object('category', 'trust', 'metric', 'active_referrals_count', 'threshold', 5)
  ),
  (
    'xp_badge_confiance_exemplaire',
    'Confiance Exemplaire',
    '30 echanges, 0 incident, note >= 4.9 sur 12 derniers mois.',
    150,
    true,
    jsonb_build_object('category', 'trust', 'metric', 'trust_index_12m', 'threshold', 1)
  ),
  (
    'xp_badge_toujours_repond',
    'Toujours Repond',
    '50 conversations avec un temps de reponse < 4h.',
    70,
    true,
    jsonb_build_object('category', 'trust', 'metric', 'fast_reply_conversations_count', 'threshold', 50)
  ),
  (
    'xp_badge_all_star_mois',
    'All-Star du Mois',
    'Top 10 Style XP sur un mois donne.',
    120,
    true,
    jsonb_build_object('category', 'trust', 'metric', 'monthly_style_xp_rank', 'threshold', 10)
  )
on conflict (badge_code) do update
set
  label = excluded.label,
  description = excluded.description,
  xp_bonus = excluded.xp_bonus,
  is_active = excluded.is_active,
  metadata = excluded.metadata;
