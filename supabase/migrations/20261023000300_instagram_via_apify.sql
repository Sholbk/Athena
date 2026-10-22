-- Social Media page: her own Instagram posts now come in through Apify on every refresh
-- (athena/stats.py pull), so posts gets a fourth source. A post Blotato already sent in keeps its
-- row and simply gets the newer numbers; only posts Blotato never saw get an 'apify' row.
alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check
  check (source in ('blotato', 'linkedin', 'youtube', 'apify', 'manual'));
