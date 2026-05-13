-- AgentSquare: schema, RLS, and helpers for the agent-social MVP.

create extension if not exists "uuid-ossp";

-- Profiles are 1:1 with either an auth.user (human) or an agent (no auth user).
create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique references auth.users(id) on delete cascade,
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  is_agent boolean not null default false,
  created_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{2,32}$')
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists profiles_is_agent_idx on public.profiles (is_agent);

-- Agent-specific metadata (only present for is_agent = true profiles).
create table if not exists public.agents (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  persona_prompt text not null,
  interests text[] not null default '{}',
  reply_style text,
  is_active boolean not null default true,
  cooldown_seconds integer not null default 60,
  last_action_at timestamptz,
  activity_settings jsonb not null default '{}'::jsonb
);

create index if not exists agents_active_idx on public.agents (is_active);

-- Posts (both top-level and replies, threaded via parent_id).
create table if not exists public.posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.posts(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists posts_parent_id_idx on public.posts (parent_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists posts_created_at_idx on public.posts (created_at desc);

-- Activity log so we can show why an agent replied and rate-limit per agent.
create table if not exists public.agent_activity_log (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('mention', 'topic', 'proactive')),
  source_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists agent_activity_agent_idx on public.agent_activity_log (agent_id, created_at desc);
create index if not exists agent_activity_post_idx on public.agent_activity_log (post_id);

-- Auto-provision a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  candidate_handle text;
  attempts int := 0;
begin
  base_handle := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-z0-9_]', '', 'g'));
  if char_length(base_handle) < 2 then
    base_handle := 'user';
  end if;
  candidate_handle := base_handle;
  while exists (select 1 from public.profiles where handle = candidate_handle) and attempts < 25 loop
    attempts := attempts + 1;
    candidate_handle := base_handle || attempts::text;
  end loop;

  insert into public.profiles (user_id, handle, display_name, is_agent)
  values (new.id, candidate_handle, coalesce(new.raw_user_meta_data->>'display_name', candidate_handle), false);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.posts enable row level security;
alter table public.agent_activity_log enable row level security;

-- Profiles: world-readable, owner can update their own.
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Agents: world-readable, no client writes (managed via service role).
drop policy if exists "agents_read_all" on public.agents;
create policy "agents_read_all" on public.agents for select using (true);

-- Posts: world-readable. Authenticated users insert posts only as their own profile and only as humans.
drop policy if exists "posts_read_all" on public.posts;
create policy "posts_read_all" on public.posts for select using (true);

drop policy if exists "posts_insert_as_self" on public.posts;
create policy "posts_insert_as_self" on public.posts for insert
  with check (
    author_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
  );

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete
  using (
    author_id in (select id from public.profiles where user_id = auth.uid())
  );

-- Agent activity log: world-readable so profiles can show provenance. Writes are service-role only.
drop policy if exists "activity_read_all" on public.agent_activity_log;
create policy "activity_read_all" on public.agent_activity_log for select using (true);

-- Realtime: enable on posts so the feed updates live.
alter publication supabase_realtime add table public.posts;
