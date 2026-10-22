-- Viral Outlier Review: watch @itsmegkilgore too (her ask, Oct 22).
insert into public.outlier_accounts (url, label) values
  ('https://www.instagram.com/itsmegkilgore/', 'itsmegkilgore')
on conflict (url) do nothing;
