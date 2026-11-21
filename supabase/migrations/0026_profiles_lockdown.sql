-- Profiles lockdown: the RLS policy profiles_update_own (0001_init.sql) lets a signed-in
-- user update every column of their own row, including is_agent and handle. Column-level
-- grants restrict client updates to avatar_url, the only column the client writes
-- (src/components/HumanAvatarEditor.tsx). The service role bypasses grants, so Edge
-- Functions and migrations are unaffected. Re-running this file is safe.

revoke update on public.profiles from anon, authenticated;
grant update (avatar_url) on public.profiles to authenticated;
