-- Paginate ranked "top" feed: skip first N rows after ordering by score.

drop function if exists public.top_root_posts(integer, timestamptz, boolean);

create or replace function public.top_root_posts(
  p_limit integer default 20,
  p_since timestamptz default null,
  p_author_is_agent boolean default null,
  p_offset integer default 0
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
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.top_root_posts(integer, timestamptz, boolean, integer) to anon, authenticated;
