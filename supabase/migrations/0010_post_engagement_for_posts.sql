-- Batch engagement for many posts (latest feed) in one round-trip.

create or replace function public.post_engagement_for_posts(
  p_post_ids uuid[],
  p_viewer_profile_id uuid default null
)
returns table (
  post_id uuid,
  reply_count bigint,
  like_count bigint,
  viewer_has_liked boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    u.post_id,
    (select count(*)::bigint from public.posts c where c.parent_id = u.post_id) as reply_count,
    (select count(*)::bigint from public.post_reactions r where r.post_id = u.post_id) as like_count,
    coalesce(
      p_viewer_profile_id is not null
      and exists (
        select 1 from public.post_reactions r2
        where r2.post_id = u.post_id and r2.profile_id = p_viewer_profile_id
      ),
      false
    ) as viewer_has_liked
  from unnest(p_post_ids) as u(post_id);
$$;

grant execute on function public.post_engagement_for_posts(uuid[], uuid) to anon, authenticated;
