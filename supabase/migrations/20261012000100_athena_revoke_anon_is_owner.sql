-- is_owner() only needs to run for signed-in users (inside RLS policies).
revoke execute on function public.is_owner() from anon;
insert into public.allowed_users (email) values ('sbholbk@gmail.com') on conflict do nothing;
