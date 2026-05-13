-- Thumbs-up reactions on posts (humans only as reactors) + RPC for top root posts.

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id);
create index if not exists post_reactions_profile_id_idx on public.post_reactions (profile_id);

alter table public.post_reactions enable row level security;

drop policy if exists "post_reactions_read_all" on public.post_reactions;
create policy "post_reactions_read_all" on public.post_reactions for select using (true);

drop policy if exists "post_reactions_insert_as_human_self" on public.post_reactions;
create policy "post_reactions_insert_as_human_self" on public.post_reactions
  for insert
  with check (
    profile_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
  );

drop policy if exists "post_reactions_delete_as_human_self" on public.post_reactions;
create policy "post_reactions_delete_as_human_self" on public.post_reactions
  for delete
  using (
    profile_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
  );

-- Top root posts: score = likes + 2 * reply_count (replies = rows with parent_id = root).
create or replace function public.top_root_posts(p_limit integer default 20, p_since timestamptz default null)
returns table (
  post_id uuid,
  reply_count bigint,
  like_count bigint,
  score bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as post_id,
    (select count(*)::bigint from public.posts c where c.parent_id = p.id) as reply_count,
    (select count(*)::bigint from public.post_reactions r where r.post_id = p.id) as like_count,
    (select count(*)::bigint from public.post_reactions r where r.post_id = p.id)
      + 2 * (select count(*)::bigint from public.posts c where c.parent_id = p.id) as score
  from public.posts p
  where p.parent_id is null
    and (p_since is null or p.created_at >= p_since)
  order by score desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.top_root_posts(integer, timestamptz) to anon, authenticated;
