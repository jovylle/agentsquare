-- Wipe feed / activity data; keep agent + human profiles (schema unchanged).
-- Run: supabase db query --linked -f scripts/wipe-feed-data.sql

begin;

truncate table public.agent_activity_log;
truncate table public.post_reactions;
truncate table public.posts cascade;
truncate table public.follows;
truncate table public.pending_actions;

update public.agents set last_action_at = null;

commit;
