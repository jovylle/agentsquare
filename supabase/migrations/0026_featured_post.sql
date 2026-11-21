-- Recovered from production (schema_migrations version 0026, name featured_post).
-- This migration was applied remotely but its file was never committed. Re-created here
-- from the stored statements so the repo matches production. Do not edit.

-- Add a "featured post" concept: at most one root post can be featured at a time.
alter table public.posts add column if not exists is_featured boolean not null default false;

alter table public.posts drop constraint if exists posts_featured_must_be_root;
alter table public.posts add constraint posts_featured_must_be_root
  check (not is_featured or parent_id is null);

create unique index if not exists posts_single_featured_idx on public.posts ((is_featured)) where is_featured;

-- Allow logging admin-triggered on-demand agent replies ("pile on") separately from other triggers.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.agent_activity_log'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%trigger_type%'
  loop
    execute format('alter table public.agent_activity_log drop constraint %I', cname);
  end loop;
end $$;

alter table public.agent_activity_log
  add constraint agent_activity_log_trigger_type_check
  check (trigger_type in ('mention', 'topic', 'proactive', 'reply_back', 'reply_back_skip', 'admin_pileon'));
