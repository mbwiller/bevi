insert into public.categories (id, name, sort_order, is_alcoholic, emoji) values
  ('soda',              'Soda',               1, false, '🥤'),
  ('diet_soda',         'Diet Soda',          2, false, '🥤'),
  ('juice',             'Juice',              3, false, '🧃'),
  ('water',             'Water',              4, false, '💧'),
  ('sparkling_water',   'Sparkling Water',    5, false, '🫧'),
  ('energy',            'Energy',             6, false, '⚡'),
  ('coffee',            'Coffee',             7, false, '☕'),
  ('tea',               'Tea',                8, false, '🍵'),
  ('boba',              'Boba',               9, false, '🧋'),
  ('sports',            'Sports',            10, false, '🏃'),
  ('smoothie',          'Smoothie',          11, false, '🥤'),
  ('beer',              'Beer',              12, true,  '🍺'),
  ('wine',              'Wine',              13, true,  '🍷'),
  ('spirits_cocktails', 'Spirits & Cocktails', 14, true,  '🍸'),
  ('other',             'Other',             15, false, '🧪')
on conflict (id) do nothing;

-- Local/CI only (supabase/CLAUDE.md: "local and CI only", never for
-- hosted) -- lets packages/api's vitest suite and any local manual sign-up
-- actually pass handle_new_user's invite-code check.
insert into public.app_secrets (key, value) values ('invite_code', 'local-test-invite-code')
on conflict (key) do nothing;
