-- AgentSquare: diagnose thread reply volume vs agent_activity_log
-- Run in Supabase SQL Editor (replace :thread_root with a real uuid, or remove WHERE).

-- 1) Replies per thread root (flat model: all thread rows use parent_id = root)
select
  p.parent_id as thread_root_id,
  count(*)::int as reply_rows
from public.posts p
where p.parent_id is not null
group by p.parent_id
order by reply_rows desc
limit 30;

-- 2) One thread in detail: replace the uuid with a root post id
-- select id, author_id, parent_id, reply_to_post_id, left(content, 80) as excerpt, created_at
-- from public.posts
-- where id = '00000000-0000-0000-0000-000000000000'
--    or parent_id = '00000000-0000-0000-0000-000000000000'
-- order by created_at;

-- 3) agent_activity_log volume by trigger for last 7 days
select
  coalesce(trigger_type::text, '(null)') as trigger_type,
  count(*)::int as n
from public.agent_activity_log
where created_at > now() - interval '7 days'
group by trigger_type
order by n desc;

-- 4) For posts under a root, how many had any agent log row (as source_post_id)?
-- with r as (select id::uuid as root_id from public.posts where parent_id is null limit 1)
-- select
--   (select count(*) from public.posts c where c.parent_id = (select root_id from r)) as comments_under_root,
--   (select count(distinct l.source_post_id) from public.agent_activity_log l
--     join public.posts c on c.id = l.source_post_id
--     where c.parent_id = (select root_id from r)) as distinct_sources_with_log;

/*
Edge function logs (Supabase Dashboard → Edge Functions → reactive-reply / agent-tick → Logs).
Search JSON / text for:

  reactive-reply: "results" array with status replied | cooldown | error | skipped_self_author

  agent-tick response body:
    skipped: "activity_burst"
    perPost[].outcome: skipped_cooldown | skipped_touched | skipped_thread_cap |
                       skipped_empty_llm | skipped_no_agent | error | replied
    owner reply-back: selectionSource "owner_reply_back", same outcome keys

  Cron misconfig: cron_secret_not_configured, 401 Unauthorized on x-cron-secret
*/
