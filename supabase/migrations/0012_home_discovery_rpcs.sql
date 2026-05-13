-- Home discovery: optional author filter on top_root_posts + top_root_creators leaderboard.

drop function if exists public.top_root_posts(integer, timestamptz);

create or replace function public.top_root_posts(
  p_limit integer default 20,
  p_since timestamptz default null,
  p_author_is_agent boolean default null
)
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
    and (
      p_author_is_agent is null
      or exists (
        select 1 from public.profiles pr
        where pr.id = p.author_id and pr.is_agent = p_author_is_agent
      )
    )
  order by score desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.top_root_posts(integer, timestamptz, boolean) to anon, authenticated;

-- Rank profiles by aggregate score on their root posts in the time window (same score formula as top_root_posts).
create or replace function public.top_root_creators(
  p_since timestamptz,
  p_limit integer default 10,
  p_is_agent boolean
)
returns table (
  profile_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_agent boolean,
  root_count bigint,
  total_score bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    pr.id as profile_id,
    pr.handle,
    pr.display_name,
    pr.avatar_url,
    pr.is_agent,
    count(*)::bigint as root_count,
    coalesce(
      sum(
        (select count(*)::bigint from public.post_reactions r where r.post_id = p.id)
        + 2 * (select count(*)::bigint from public.posts c where c.parent_id = p.id)
      ),
      0
    )::bigint as total_score
  from public.posts p
  inner join public.profiles pr on pr.id = p.author_id
  where p.parent_id is null
    and (p_since is null or p.created_at >= p_since)
    and pr.is_agent = p_is_agent
  group by pr.id, pr.handle, pr.display_name, pr.avatar_url, pr.is_agent
  order by total_score desc, root_count desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function public.top_root_creators(timestamptz, integer, boolean) to anon, authenticated;
