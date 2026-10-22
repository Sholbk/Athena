-- Viral Outlier Review: 15 more accounts in her space to watch (found Oct 22: each posts reels
-- at least twice a week and has 10,000 to 1,000,000 followers). Same table the job already reads.
insert into public.outlier_accounts (url, label) values
  ('https://www.instagram.com/primepulse.inc/', 'primepulse.inc'),
  ('https://www.instagram.com/jasminestar/', 'jasminestar'),
  ('https://www.instagram.com/donaldmiller/', 'donaldmiller'),
  ('https://www.instagram.com/amyporterfield/', 'amyporterfield'),
  ('https://www.instagram.com/starter_story/', 'starter_story'),
  ('https://www.instagram.com/peter.visuals/', 'peter.visuals'),
  ('https://www.instagram.com/viralclubhouse_/', 'viralclubhouse_'),
  ('https://www.instagram.com/elisedarma/', 'elisedarma'),
  ('https://www.instagram.com/theproductboss/', 'theproductboss'),
  ('https://www.instagram.com/mehakmarketing/', 'mehakmarketing'),
  ('https://www.instagram.com/dayananikoll/', 'dayananikoll'),
  ('https://www.instagram.com/kristinassaad/', 'kristinassaad'),
  ('https://www.instagram.com/jeffmillermarketing/', 'jeffmillermarketing'),
  ('https://www.instagram.com/simranmarwah.me/', 'simranmarwah.me'),
  ('https://www.instagram.com/cubicletoceo/', 'cubicletoceo')
on conflict (url) do nothing;
