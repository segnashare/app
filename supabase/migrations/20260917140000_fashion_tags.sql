-- Fashion tags catalog + style look / community inspiration tagging

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  label text not null,
  slug text not null,
  reach_tier text not null default '',
  relevance_contexts text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tags_slug_key unique (slug),
  constraint tags_label_key unique (label)
);

create index if not exists idx_tags_category_sort on public.tags (category, sort_order asc);

create table if not exists public.style_look_tags (
  look_id uuid not null references public.style_looks (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (look_id, tag_id)
);

create index if not exists idx_style_look_tags_tag on public.style_look_tags (tag_id);

create table if not exists public.community_inspiration_tags (
  inspiration_id uuid not null references public.community_inspirations (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (inspiration_id, tag_id)
);

create index if not exists idx_community_inspiration_tags_tag on public.community_inspiration_tags (tag_id);

alter table public.tags enable row level security;
alter table public.style_look_tags enable row level security;
alter table public.community_inspiration_tags enable row level security;

grant select on public.tags to authenticated;
grant select on public.style_look_tags to authenticated;
grant select on public.community_inspiration_tags to authenticated;

create policy tags_select_authenticated on public.tags for select to authenticated using (is_active = true);

create policy style_look_tags_select_published on public.style_look_tags for select to authenticated
using (
  exists (
    select 1 from public.style_looks sl
    where sl.id = look_id and sl.published = true
  )
);

create policy community_inspiration_tags_select_published on public.community_inspiration_tags for select to authenticated
using (
  exists (
    select 1 from public.community_inspirations ci
    where ci.id = inspiration_id and ci.status = 'published' and ci.deleted_at is null
  )
);

insert into public.tags (category, label, slug, reach_tier, relevance_contexts, sort_order)
values
  ('Fondamentaux', 'ModeFemme2026', 'modefemme2026', 'Élevé', array['lookbook','quotidien','défilé'], 1),
  ('Fondamentaux', 'ModeFemme', 'modefemme', 'Très élevé', array['lookbook','quotidien','défilé'], 2),
  ('Fondamentaux', 'FashionFemme', 'fashionfemme', 'Élevé', array['lookbook','quotidien','défilé'], 3),
  ('Fondamentaux', 'InstaMode', 'instamode', 'Très élevé', array['lookbook','quotidien','défilé'], 4),
  ('Fondamentaux', 'WomenInStyle', 'womeninstyle', 'Élevé', array['lookbook','quotidien','défilé'], 5),
  ('Fondamentaux', 'StyleFemme', 'stylefemme', 'Élevé', array['lookbook','quotidien','défilé'], 6),
  ('Fondamentaux', 'FashionForward', 'fashionforward', 'Élevé', array['lookbook','quotidien','défilé'], 7),
  ('Fondamentaux', 'FashionDaily', 'fashiondaily', 'Élevé', array['lookbook','quotidien','défilé'], 8),
  ('Élégance', 'ModeLadylike', 'modeladylike', 'Moyen', array['lookbook','défilé','quotidien'], 9),
  ('Élégance', 'ElegantStyle', 'elegantstyle', 'Moyen', array['lookbook','défilé','quotidien'], 10),
  ('Élégance', 'ChicStyle', 'chicstyle', 'Moyen', array['lookbook','défilé','quotidien'], 11),
  ('Élégance', 'QuietLuxury', 'quietluxury', 'Moyen', array['lookbook','défilé','quotidien'], 12),
  ('Élégance', 'ParisianChic', 'parisianchic', 'Moyen', array['lookbook','défilé','quotidien'], 13),
  ('Élégance', 'ClassyOutfits', 'classyoutfits', 'Moyen', array['lookbook','défilé','quotidien'], 14),
  ('Élégance', 'EffortlessChic', 'effortlesschic', 'Moyen', array['lookbook','défilé','quotidien'], 15),
  ('Élégance', 'ModernClassic', 'modernclassic', 'Moyen', array['lookbook','défilé','quotidien'], 16),
  ('Élégance', 'TailoringWomen', 'tailoringwomen', 'Moyen', array['lookbook','défilé'], 17),
  ('Élégance', 'BlazerLook', 'blazerlook', 'Moyen', array['lookbook','défilé'], 18),
  ('Élégance', 'PantalonTailleur', 'pantalontailleur', 'Moyen', array['lookbook','défilé'], 19),
  ('Élégance', 'SleekStyle', 'sleekstyle', 'Moyen', array['lookbook','défilé'], 20),
  ('Élégance', 'SoftPowerDress', 'softpowerdress', 'Moyen', array['lookbook','défilé'], 21),
  ('Élégance', 'StructuredLook', 'structuredlook', 'Moyen', array['lookbook','défilé'], 22),
  ('Élégance', 'MinimalChic', 'minimalchic', 'Moyen', array['lookbook','défilé'], 23),
  ('Élégance', 'TimelessWardrobe', 'timelesswardrobe', 'Moyen', array['lookbook','défilé'], 24),
  ('Denim', 'DenimTrends', 'denimtrends', 'Moyen', array['lookbook','quotidien'], 25),
  ('Denim', 'DenimLook', 'denimlook', 'Moyen', array['lookbook','quotidien'], 26),
  ('Denim', 'JeanLarge', 'jeanlarge', 'Moyen', array['lookbook','quotidien'], 27),
  ('Denim', 'BaggyJeans', 'baggyjeans', 'Moyen', array['lookbook','quotidien'], 28),
  ('Denim', 'DenimOnDenim', 'denimondenim', 'Moyen', array['lookbook','quotidien'], 29),
  ('Denim', 'RawDenim', 'rawdenim', 'Moyen', array['lookbook','quotidien'], 30),
  ('Denim', 'VintageDenim', 'vintagedenim', 'Moyen', array['lookbook','quotidien'], 31),
  ('Denim', 'DenimStyle', 'denimstyle', 'Moyen', array['lookbook','quotidien'], 32),
  ('Denim', 'JortSeason', 'jortseason', 'Moyen', array['quotidien','lookbook'], 33),
  ('Denim', 'CargoJeans', 'cargojeans', 'Moyen', array['quotidien','lookbook'], 34),
  ('Denim', 'StraightLegJeans', 'straightlegjeans', 'Moyen', array['quotidien','lookbook'], 35),
  ('Denim', 'DenimAddict', 'denimaddict', 'Moyen', array['quotidien','lookbook'], 36),
  ('Denim', 'JeanVintage', 'jeanvintage', 'Moyen', array['quotidien','lookbook'], 37),
  ('Denim', 'FlaredJeans', 'flaredjeans', 'Moyen', array['quotidien','lookbook'], 38),
  ('Denim', 'UtilityDenim', 'utilitydenim', 'Moyen', array['quotidien','lookbook'], 39),
  ('Denim', 'DenimMood', 'denimmood', 'Moyen', array['quotidien','lookbook'], 40),
  ('Streetwear', 'StreetstyleParis', 'streetstyleparis', 'Élevé', array['quotidien','lookbook'], 41),
  ('Streetwear', 'StreetStyle', 'streetstyle', 'Élevé', array['quotidien','lookbook'], 42),
  ('Streetwear', 'UrbanChic', 'urbanchic', 'Moyen', array['quotidien','lookbook'], 43),
  ('Streetwear', 'CityLook', 'citylook', 'Moyen', array['quotidien','lookbook'], 44),
  ('Streetwear', 'ParisStyle', 'parisstyle', 'Moyen', array['quotidien','lookbook'], 45),
  ('Streetwear', 'ParisFashion', 'parisfashion', 'Moyen', array['quotidien','lookbook'], 46),
  ('Streetwear', 'StreetFashion', 'streetfashion', 'Élevé', array['quotidien','lookbook'], 47),
  ('Streetwear', 'StyleDeRue', 'stylederue', 'Moyen', array['quotidien','lookbook'], 48),
  ('Streetwear', 'SneakerStyle', 'sneakerstyle', 'Moyen', array['quotidien','lookbook'], 49),
  ('Streetwear', 'OversizedLook', 'oversizedlook', 'Moyen', array['quotidien','lookbook'], 50),
  ('Streetwear', 'Athleisure', 'athleisure', 'Moyen', array['quotidien','lookbook'], 51),
  ('Streetwear', 'CasualCool', 'casualcool', 'Moyen', array['quotidien','lookbook'], 52),
  ('Streetwear', 'CoolGirlStyle', 'coolgirlstyle', 'Moyen', array['quotidien','lookbook'], 53),
  ('Streetwear', 'OffDutyLook', 'offdutylook', 'Moyen', array['quotidien','lookbook'], 54),
  ('Streetwear', 'CitySneakers', 'citysneakers', 'Moyen', array['quotidien','lookbook'], 55),
  ('Streetwear', 'LayeredLook', 'layeredlook', 'Moyen', array['quotidien','lookbook'], 56),
  ('Couleurs', 'CouleursPop', 'couleurspop', 'Moyen', array['lookbook','défilé'], 57),
  ('Couleurs', 'ColorPop', 'colorpop', 'Moyen', array['lookbook','défilé'], 58),
  ('Couleurs', 'BoldColors', 'boldcolors', 'Moyen', array['lookbook','défilé'], 59),
  ('Couleurs', 'ColorBlocking', 'colorblocking', 'Moyen', array['lookbook','défilé'], 60),
  ('Couleurs', 'ChromaticStyle', 'chromaticstyle', 'Moyen', array['lookbook','défilé'], 61),
  ('Couleurs', 'PinkAesthetic', 'pinkaesthetic', 'Moyen', array['lookbook','défilé'], 62),
  ('Couleurs', 'BlueMood', 'bluemood', 'Moyen', array['lookbook','défilé'], 63),
  ('Couleurs', 'GreenLook', 'greenlook', 'Moyen', array['lookbook','défilé'], 64),
  ('Couleurs', 'PastelPalette', 'pastelpalette', 'Moyen', array['lookbook','quotidien'], 65),
  ('Couleurs', 'RedStatement', 'redstatement', 'Moyen', array['lookbook','quotidien'], 66),
  ('Couleurs', 'MonochromeLook', 'monochromelook', 'Moyen', array['lookbook','quotidien'], 67),
  ('Couleurs', 'NeonAccents', 'neonaccents', 'Moyen', array['lookbook','quotidien'], 68),
  ('Couleurs', 'SunsetTones', 'sunsettones', 'Moyen', array['lookbook','quotidien'], 69),
  ('Couleurs', 'VibrantStyle', 'vibrantstyle', 'Moyen', array['lookbook','quotidien'], 70),
  ('Couleurs', 'RainbowFit', 'rainbowfit', 'Moyen', array['lookbook','quotidien'], 71),
  ('Couleurs', 'SoftTones', 'softtones', 'Moyen', array['lookbook','quotidien'], 72),
  ('Esthétiques', 'CoquetteStyle', 'coquettestyle', 'Moyen', array['lookbook','quotidien'], 73),
  ('Esthétiques', 'Balletcore', 'balletcore', 'Moyen', array['lookbook','quotidien'], 74),
  ('Esthétiques', 'FeminineEnergy', 'feminineenergy', 'Moyen', array['lookbook','quotidien'], 75),
  ('Esthétiques', 'GirlyStyle', 'girlystyle', 'Moyen', array['lookbook','quotidien'], 76),
  ('Esthétiques', 'RomanticLook', 'romanticlook', 'Moyen', array['lookbook','quotidien'], 77),
  ('Esthétiques', 'RibbonDetails', 'ribbondetails', 'Moyen', array['lookbook','quotidien'], 78),
  ('Esthétiques', 'PearlDetails', 'pearldetails', 'Moyen', array['lookbook','quotidien'], 79),
  ('Esthétiques', 'FloralDress', 'floraldress', 'Moyen', array['lookbook','quotidien'], 80),
  ('Esthétiques', 'OldMoneyStyle', 'oldmoneystyle', 'Moyen', array['lookbook','quotidien'], 81),
  ('Esthétiques', 'CleanGirlAesthetic', 'cleangirlaesthetic', 'Moyen', array['lookbook','quotidien'], 82),
  ('Esthétiques', 'GlamGirl', 'glamgirl', 'Moyen', array['lookbook','quotidien'], 83),
  ('Esthétiques', 'EdgyFeminine', 'edgyfeminine', 'Moyen', array['lookbook','quotidien'], 84),
  ('Esthétiques', 'PreppyLook', 'preppylook', 'Moyen', array['lookbook','quotidien'], 85),
  ('Esthétiques', 'BohoChic', 'bohochic', 'Moyen', array['lookbook','quotidien'], 86),
  ('Esthétiques', 'Y2KFashion', 'y2kfashion', 'Moyen', array['lookbook','quotidien'], 87),
  ('Esthétiques', 'SirenStyle', 'sirenstyle', 'Moyen', array['lookbook','quotidien'], 88),
  ('Vintage & seconde main', 'ModeVintage', 'modevintage', 'Moyen', array['lookbook','quotidien'], 89),
  ('Vintage & seconde main', 'VintageLook', 'vintagelook', 'Moyen', array['lookbook','quotidien'], 90),
  ('Vintage & seconde main', 'RetroStyle', 'retrostyle', 'Moyen', array['lookbook','quotidien'], 91),
  ('Vintage & seconde main', 'SecondHandFashion', 'secondhandfashion', 'Moyen', array['lookbook','quotidien'], 92),
  ('Vintage & seconde main', 'ThriftedStyle', 'thriftedstyle', 'Moyen', array['lookbook','quotidien'], 93),
  ('Vintage & seconde main', 'UpcycledFashion', 'upcycledfashion', 'Moyen', array['lookbook','quotidien'], 94),
  ('Vintage & seconde main', 'ArchiveFashion', 'archivefashion', 'Moyen', array['lookbook','quotidien'], 95),
  ('Vintage & seconde main', 'PrelovedStyle', 'prelovedstyle', 'Moyen', array['lookbook','quotidien'], 96),
  ('Vintage & seconde main', 'VintageChanel', 'vintagechanel', 'Faible à moyen', array['quotidien','lookbook'], 97),
  ('Vintage & seconde main', 'VintageDior', 'vintagedior', 'Faible à moyen', array['quotidien','lookbook'], 98),
  ('Vintage & seconde main', 'ThriftFlip', 'thriftflip', 'Moyen', array['quotidien','lookbook'], 99),
  ('Vintage & seconde main', 'SustainableWardrobe', 'sustainablewardrobe', 'Moyen', array['quotidien','lookbook'], 100),
  ('Vintage & seconde main', 'CircularFashion', 'circularfashion', 'Moyen', array['quotidien','lookbook'], 101),
  ('Vintage & seconde main', 'ResponsibleFashion', 'responsiblefashion', 'Moyen', array['quotidien','lookbook'], 102),
  ('Vintage & seconde main', 'WardrobeRefresh', 'wardroberefresh', 'Moyen', array['quotidien','lookbook'], 103),
  ('Vintage & seconde main', 'ReuseStyle', 'reusestyle', 'Moyen', array['quotidien','lookbook'], 104),
  ('Luxe & runway', 'LuxuryFashion', 'luxuryfashion', 'Très élevé', array['défilé','lookbook'], 105),
  ('Luxe & runway', 'LuxuryStyle', 'luxurystyle', 'Élevé', array['défilé','lookbook'], 106),
  ('Luxe & runway', 'HauteCouture', 'hautecouture', 'Élevé', array['défilé','lookbook'], 107),
  ('Luxe & runway', 'CoutureLook', 'couturelook', 'Élevé', array['défilé','lookbook'], 108),
  ('Luxe & runway', 'RunwayReady', 'runwayready', 'Élevé', array['défilé','lookbook'], 109),
  ('Luxe & runway', 'FashionWeek', 'fashionweek', 'Très élevé', array['défilé','lookbook'], 110),
  ('Luxe & runway', 'DesignerLook', 'designerlook', 'Élevé', array['défilé','lookbook'], 111),
  ('Luxe & runway', 'StatementPiece', 'statementpiece', 'Élevé', array['défilé','lookbook'], 112),
  ('Luxe & runway', 'ParisFashionWeek', 'parisfashionweek', 'Élevé', array['défilé','lookbook'], 113),
  ('Luxe & runway', 'RunwayInspo', 'runwayinspo', 'Élevé', array['défilé','lookbook'], 114),
  ('Luxe & runway', 'CoutureDetails', 'couturedetails', 'Élevé', array['défilé','lookbook'], 115),
  ('Luxe & runway', 'FashionShow', 'fashionshow', 'Élevé', array['défilé','lookbook'], 116),
  ('Luxe & runway', 'FrontRowStyle', 'frontrowstyle', 'Élevé', array['défilé','lookbook'], 117),
  ('Luxe & runway', 'EditorialLook', 'editoriallook', 'Élevé', array['défilé','lookbook'], 118),
  ('Luxe & runway', 'HighFashion', 'highfashion', 'Élevé', array['défilé','lookbook'], 119),
  ('Luxe & runway', 'AvantGardeStyle', 'avantgardestyle', 'Élevé', array['défilé','lookbook'], 120),
  ('Quotidien', 'CapsuleWardrobe', 'capsulewardrobe', 'Élevé', array['quotidien'], 121),
  ('Quotidien', 'WardrobeEssentials', 'wardrobeessentials', 'Élevé', array['quotidien'], 122),
  ('Quotidien', 'MinimalWardrobe', 'minimalwardrobe', 'Élevé', array['quotidien'], 123),
  ('Quotidien', 'EverydayStyle', 'everydaystyle', 'Élevé', array['quotidien'], 124),
  ('Quotidien', 'DailyOutfit', 'dailyoutfit', 'Élevé', array['quotidien'], 125),
  ('Quotidien', 'EasyOutfits', 'easyoutfits', 'Élevé', array['quotidien'], 126),
  ('Quotidien', 'WearItAgain', 'wearitagain', 'Élevé', array['quotidien'], 127),
  ('Quotidien', 'SmartDressing', 'smartdressing', 'Élevé', array['quotidien'], 128),
  ('Quotidien', 'FrenchGirlStyle', 'frenchgirlstyle', 'Moyen', array['quotidien','lookbook'], 129),
  ('Quotidien', 'MadeInFrance', 'madeinfrance', 'Moyen', array['quotidien','lookbook'], 130),
  ('Quotidien', 'ParisianWardrobe', 'parisianwardrobe', 'Moyen', array['quotidien','lookbook'], 131),
  ('Quotidien', 'EffortlessStyle', 'effortlessstyle', 'Moyen', array['quotidien','lookbook'], 132),
  ('Quotidien', 'NeutralOutfits', 'neutraloutfits', 'Moyen', array['quotidien','lookbook'], 133),
  ('Quotidien', 'ComfortChic', 'comfortchic', 'Moyen', array['quotidien','lookbook'], 134),
  ('Quotidien', 'PracticalStyle', 'practicalstyle', 'Moyen', array['quotidien','lookbook'], 135),
  ('Quotidien', 'WeekendLook', 'weekendlook', 'Moyen', array['quotidien','lookbook'], 136),
  ('Viraux & formats', 'TryOnHaul', 'tryonhaul', 'Très élevé', array['quotidien','lookbook','défilé'], 137),
  ('Viraux & formats', 'GRWM', 'grwm', 'Très élevé', array['quotidien','lookbook','défilé'], 138),
  ('Viraux & formats', 'FitCheck', 'fitcheck', 'Très élevé', array['quotidien','lookbook','défilé'], 139),
  ('Viraux & formats', 'OutfitCheck', 'outfitcheck', 'Très élevé', array['quotidien','lookbook','défilé'], 140),
  ('Viraux & formats', 'StyleHaul', 'stylehaul', 'Très élevé', array['quotidien','lookbook','défilé'], 141),
  ('Viraux & formats', 'NewInFashion', 'newinfashion', 'Très élevé', array['quotidien','lookbook','défilé'], 142),
  ('Viraux & formats', 'ClosetTour', 'closettour', 'Très élevé', array['quotidien','lookbook','défilé'], 143),
  ('Viraux & formats', 'WhatIWore', 'whatiwore', 'Très élevé', array['quotidien','lookbook','défilé'], 144),
  ('Viraux & formats', 'GetReadyWithMe', 'getreadywithme', 'Très élevé', array['quotidien','lookbook'], 145),
  ('Viraux & formats', 'FashionTok', 'fashiontok', 'Très élevé', array['quotidien','lookbook'], 146),
  ('Viraux & formats', 'TikTokFashion', 'tiktokfashion', 'Très élevé', array['quotidien','lookbook'], 147),
  ('Viraux & formats', 'ViralStyle', 'viralstyle', 'Très élevé', array['quotidien','lookbook'], 148),
  ('Viraux & formats', 'TrendAlert', 'trendalert', 'Très élevé', array['quotidien','lookbook'], 149),
  ('Viraux & formats', 'HotGirlWalk', 'hotgirlwalk', 'Très élevé', array['quotidien','lookbook'], 150),
  ('Viraux & formats', 'BeforeAfterStyle', 'beforeafterstyle', 'Très élevé', array['quotidien','lookbook'], 151),
  ('Viraux & formats', 'StyleTransition', 'styletransition', 'Très élevé', array['quotidien','lookbook'], 152),
  ('Viraux & formats', 'FashionReels', 'fashionreels', 'Élevé', array['quotidien','lookbook'], 153),
  ('Viraux & formats', 'TransitionVideo', 'transitionvideo', 'Élevé', array['quotidien','lookbook'], 154),
  ('Viraux & formats', 'OutfitTransition', 'outfittransition', 'Élevé', array['quotidien','lookbook'], 155),
  ('Viraux & formats', 'StyleChallenge', 'stylechallenge', 'Élevé', array['quotidien','lookbook'], 156),
  ('Viraux & formats', 'DayToNightLook', 'daytonightlook', 'Élevé', array['quotidien','lookbook'], 157),
  ('Viraux & formats', 'HowToStyle', 'howtostyle', 'Élevé', array['quotidien','lookbook'], 158),
  ('Viraux & formats', '3WaysToWear', '3waystowear', 'Élevé', array['quotidien','lookbook'], 159),
  ('Viraux & formats', 'ClothesSwap', 'clothesswap', 'Élevé', array['quotidien','lookbook'], 160),
  ('France & Paris', 'MiroirMode', 'miroirmode', 'Élevé', array['lookbook','quotidien'], 161),
  ('France & Paris', 'ModeParis', 'modeparis', 'Élevé', array['lookbook','quotidien'], 162),
  ('France & Paris', 'ModeFrancaise', 'modefrancaise', 'Élevé', array['lookbook','quotidien'], 163),
  ('France & Paris', 'ModeChic', 'modechic', 'Élevé', array['lookbook','quotidien'], 164),
  ('France & Paris', 'TenueChic', 'tenuechic', 'Élevé', array['lookbook','quotidien'], 165),
  ('France & Paris', 'StyleParisien', 'styleparisien', 'Élevé', array['lookbook','quotidien'], 166),
  ('France & Paris', 'FashionInParis', 'fashioninparis', 'Élevé', array['lookbook','quotidien'], 167),
  ('France & Paris', 'ParisianVibes', 'parisianvibes', 'Élevé', array['lookbook','quotidien'], 168),
  ('Usage', 'ModeSemaine', 'modesemaine', 'Moyen', array['quotidien','lookbook'], 169),
  ('Usage', 'WeekendStyle', 'weekendstyle', 'Moyen', array['quotidien','lookbook'], 170),
  ('Usage', 'WorkwearWomen', 'workwearwomen', 'Moyen', array['quotidien','lookbook'], 171),
  ('Usage', 'OfficeLook', 'officelook', 'Moyen', array['quotidien','lookbook'], 172),
  ('Usage', 'AfterWorkStyle', 'afterworkstyle', 'Moyen', array['quotidien','lookbook'], 173),
  ('Usage', 'EventLook', 'eventlook', 'Moyen', array['quotidien','lookbook'], 174),
  ('Usage', 'DateNightStyle', 'datenightstyle', 'Moyen', array['quotidien','lookbook'], 175),
  ('Usage', 'TravelOutfit', 'traveloutfit', 'Moyen', array['quotidien','lookbook'], 176),
  ('Détails & accessoires', 'AccessoiresMode', 'accessoiresmode', 'Moyen', array['lookbook','quotidien'], 177),
  ('Détails & accessoires', 'SacDuJour', 'sacdujour', 'Moyen', array['lookbook','quotidien'], 178),
  ('Détails & accessoires', 'ShoesOfTheDay', 'shoesoftheday', 'Moyen', array['lookbook','quotidien'], 179),
  ('Détails & accessoires', 'JewelryDetails', 'jewelrydetails', 'Moyen', array['lookbook','quotidien'], 180),
  ('Détails & accessoires', 'BeltStyle', 'beltstyle', 'Moyen', array['lookbook','quotidien'], 181),
  ('Détails & accessoires', 'SunglassesLook', 'sunglasseslook', 'Moyen', array['lookbook','quotidien'], 182),
  ('Détails & accessoires', 'ScarfStyle', 'scarfstyle', 'Moyen', array['lookbook','quotidien'], 183),
  ('Détails & accessoires', 'BagAddict', 'bagaddict', 'Moyen', array['lookbook','quotidien'], 184),
  ('Créateurs & éditorial', 'BeautyAndFashion', 'beautyandfashion', 'Moyen', array['lookbook','défilé'], 185),
  ('Créateurs & éditorial', 'MakeItFashion', 'makeitfashion', 'Moyen', array['lookbook','défilé'], 186),
  ('Créateurs & éditorial', 'StyledByMe', 'styledbyme', 'Moyen', array['lookbook','défilé'], 187),
  ('Créateurs & éditorial', 'FashionDetails', 'fashiondetails', 'Moyen', array['lookbook','défilé'], 188),
  ('Créateurs & éditorial', 'TextureMix', 'texturemix', 'Moyen', array['lookbook','défilé'], 189),
  ('Créateurs & éditorial', 'LayeringFashion', 'layeringfashion', 'Moyen', array['lookbook','défilé'], 190),
  ('Créateurs & éditorial', 'MixAndMatch', 'mixandmatch', 'Moyen', array['lookbook','défilé'], 191),
  ('Créateurs & éditorial', 'FashionInsider', 'fashioninsider', 'Moyen', array['lookbook','défilé'], 192),
  ('Créateurs & éditorial', 'FashionPhotographer', 'fashionphotographer', 'Faible à moyen', array['lookbook','défilé'], 193),
  ('Créateurs & éditorial', 'FashionEditorial', 'fashioneditorial', 'Faible à moyen', array['lookbook','défilé'], 194),
  ('Créateurs & éditorial', 'StyleShoot', 'styleshoot', 'Faible à moyen', array['lookbook','défilé'], 195),
  ('Créateurs & éditorial', 'PoseInStyle', 'poseinstyle', 'Faible à moyen', array['lookbook','défilé'], 196),
  ('Créateurs & éditorial', 'LookbookShoot', 'lookbookshoot', 'Faible à moyen', array['lookbook','défilé'], 197),
  ('Créateurs & éditorial', 'CreativeFashion', 'creativefashion', 'Faible à moyen', array['lookbook','défilé'], 198),
  ('Créateurs & éditorial', 'IndependentDesigner', 'independentdesigner', 'Faible à moyen', array['lookbook','défilé'], 199),
  ('Créateurs & éditorial', 'ConceptStoreStyle', 'conceptstorestyle', 'Faible à moyen', array['lookbook','défilé'], 200)
on conflict (slug) do update set
  category = excluded.category,
  label = excluded.label,
  reach_tier = excluded.reach_tier,
  relevance_contexts = excluded.relevance_contexts,
  sort_order = excluded.sort_order,
  is_active = true;

create or replace function public.list_fashion_tags_v1()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'category', t.category,
        'label', t.label,
        'slug', t.slug,
        'reach_tier', t.reach_tier,
        'relevance_contexts', to_jsonb(t.relevance_contexts),
        'sort_order', t.sort_order
      )
      order by t.category asc, t.sort_order asc, t.label asc
    ),
    '[]'::jsonb
  )
  from public.tags t
  where t.is_active = true;
$$;

grant execute on function public.list_fashion_tags_v1() to authenticated;

create or replace function public.tags_caption_for_look(p_look_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    string_agg('#' || t.label, ' ' order by slt.sort_order, t.label),
    ''
  )
  from public.style_look_tags slt
  join public.tags t on t.id = slt.tag_id
  where slt.look_id = p_look_id;
$$;

create or replace function public.tags_caption_for_inspiration(p_inspiration_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    string_agg('#' || t.label, ' ' order by cit.sort_order, t.label),
    ''
  )
  from public.community_inspiration_tags cit
  join public.tags t on t.id = cit.tag_id
  where cit.inspiration_id = p_inspiration_id;
$$;

