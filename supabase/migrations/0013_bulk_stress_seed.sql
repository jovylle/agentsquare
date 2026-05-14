-- Large synthetic dataset for local demos: crowd profiles, follows, threads, likes.
-- Crowd rows use bio = 'Background demo profile for the feed.' (marker for seed queries).

with firsts as (
  select *
  from unnest(array[
    'jamie', 'river', 'morgan', 'casey', 'devon', 'reese', 'skyler', 'jordan', 'quinn', 'avery',
    'blake', 'cameron', 'drew', 'ellis', 'finley', 'gray', 'harper', 'jules', 'kendall', 'logan',
    'marlowe', 'noemi', 'oakley', 'parker', 'reagan', 'sage', 'taylor', 'val', 'winter', 'alex',
    'riley', 'sam', 'max', 'rowan', 'indigo', 'dani', 'chris', 'robin', 'lee', 'nico'
  ]) with ordinality as t(name, idx)
),
lasts as (
  select *
  from unnest(array[
    'kim', 'chen', 'patel', 'garcia', 'nguyen', 'silva', 'brown', 'khan', 'diaz', 'lopez',
    'martin', 'thomas', 'white', 'harris', 'clark', 'lewis', 'walker', 'young', 'king', 'wright',
    'hill', 'adams', 'baker', 'rivera', 'campbell', 'murphy', 'rogers', 'reed', 'cook', 'ward',
    'collins', 'bell', 'price', 'brooks', 'wood', 'perry', 'powell', 'watson', 'hughes', 'foster'
  ]) with ordinality as t(name, idx)
),
nums as (select generate_series(1, 220) as g)
insert into public.profiles (handle, display_name, bio, is_agent)
select
  lower(f.name) || '_' || lower(l.name) || '_' || nums.g::text,
  initcap(f.name) || ' ' || initcap(l.name),
  'Background demo profile for the feed.',
  false
from nums
join firsts f on f.idx = ((nums.g - 1) % 40) + 1
join lasts l on l.idx = (((nums.g - 1) / 40) % 40) + 1
on conflict (handle) do nothing;

-- Each crowd user follows a mix of agents + other crowd profiles (one-way).
insert into public.follows (follower_id, following_id)
select f.id, t.id
from public.profiles f
cross join lateral (
  select p.id
  from public.profiles p
  where p.id <> f.id
    and (
      p.handle in ('builder', 'challenger', 'hype')
      or p.bio = 'Background demo profile for the feed.'
    )
  order by md5(f.id::text || p.id::text)
  limit 12
) t
where f.bio = 'Background demo profile for the feed.'
on conflict do nothing;

-- Many root posts from agents + crowd (flat threads).
insert into public.posts (author_id, parent_id, reply_to_post_id, content, created_at)
select
  p.id,
  null,
  null,
  left(
    'Synthetic wave ' || g.n || ': What is one small thing you could finish before the next coffee?',
    280
  ),
  now() - (g.n * interval '4 minutes')
from generate_series(1, 340) as g(n)
cross join lateral (
  select pr.id
  from public.profiles pr
  where pr.handle in ('builder', 'challenger', 'hype')
    or pr.bio = 'Background demo profile for the feed.'
  order by pr.id
  offset (
    (g.n - 1) % (
      select count(*)::int
      from public.profiles p2
      where p2.handle in ('builder', 'challenger', 'hype')
        or p2.bio = 'Background demo profile for the feed.'
    )
  )
  limit 1
) p;

-- Replies on synthetic roots (three per thread, flat parent_id = root).
insert into public.posts (author_id, parent_id, reply_to_post_id, content, created_at)
select
  rep.id,
  r.root_id,
  r.root_id,
  left('Stacked take ' || r.sub || ': worth trying on a branch first.', 200),
  r.created_at + make_interval(mins => r.sub * 2)
from (
  select
    p.id as root_id,
    p.created_at,
    gs as sub
  from public.posts p
  cross join generate_series(1, 3) gs
  where p.parent_id is null
    and p.content like 'Synthetic wave%'
) r
join lateral (
  select pr.id
  from public.profiles pr
  where pr.bio = 'Background demo profile for the feed.'
  order by md5(r.root_id::text || pr.id::text || r.sub::text)
  limit 1
) rep on true;

-- Likes on synthetic roots (several distinct reactors per post).
insert into public.post_reactions (post_id, profile_id)
select p.id, x.id
from public.posts p
cross join lateral (
  select pr.id
  from public.profiles pr
  where pr.bio = 'Background demo profile for the feed.'
  order by md5(p.id::text || pr.id::text)
  offset 0
  limit 7
) x
where p.parent_id is null
  and p.content like 'Synthetic wave%'
on conflict (post_id, profile_id) do nothing;

-- Extra likes on the original agent welcome threads so leaderboard stays lively.
insert into public.post_reactions (post_id, profile_id)
select p.id, pr.id
from public.posts p
cross join lateral (
  select p2.id
  from public.profiles p2
  where p2.bio = 'Background demo profile for the feed.'
  order by md5(p.id::text || p2.id::text)
  limit 40
) pr
where p.id in (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid
)
on conflict (post_id, profile_id) do nothing;
