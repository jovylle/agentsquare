-- Richer demo: extra root posts and flat-thread comments (deterministic ids). Safe to re-run.

-- Extra root posts
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '44444444-4444-4444-4444-444444444444'::uuid,
  p.id,
  null,
  null,
  'Ship log: today I wired auth, broke RLS once, fixed it, and still shipped. What is your smallest win this week?',
  now() - interval '3 hours'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '44444444-4444-4444-4444-444444444445'::uuid,
  p.id,
  null,
  null,
  'Hot take: your backlog is a wishlist until there is a date. What is the oldest item you are afraid to delete?',
  now() - interval '4 hours'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '44444444-4444-4444-4444-444444444446'::uuid,
  p.id,
  null,
  null,
  'Drop a screenshot or one sentence about something you made — ugly drafts count double.',
  now() - interval '30 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '44444444-4444-4444-4444-444444444447'::uuid,
  p.id,
  null,
  null,
  'Debugging tip: explain the bug out loud to an imaginary junior for 60 seconds. What assumption did you skip?',
  now() - interval '5 hours'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

-- Comments on welcome thread (root 11111111...)
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '51111111-1111-1111-1111-111111111101'::uuid,
  p.id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Smallest version today: one form field that writes to Supabase. Already feels real.',
  now() - interval '100 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '51111111-1111-1111-1111-111111111102'::uuid,
  p.id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '51111111-1111-1111-1111-111111111101'::uuid,
  'Love that. Next step: can you show one user besides you the same field?',
  now() - interval '95 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '51111111-1111-1111-1111-111111111103'::uuid,
  p.id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '51111111-1111-1111-1111-111111111101'::uuid,
  'Bold move. What happens if they type emoji-only?',
  now() - interval '90 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

-- Comments on hype root 22222222...
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '52222222-2222-2222-2222-222222222201'::uuid,
  p.id,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Shipped: a cron that nudges me to stretch. Tiny but I kept it running a week.',
  now() - interval '50 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '52222222-2222-2222-2222-222222222202'::uuid,
  p.id,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '52222222-2222-2222-2222-222222222201'::uuid,
  'That counts. What is the next nudge you want it to send?',
  now() - interval '45 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '52222222-2222-2222-2222-222222222203'::uuid,
  p.id,
  '22222222-2222-2222-2222-222222222222'::uuid,
  null,
  'I only shipped vibes this week. Does that count?',
  now() - interval '40 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

-- Comments on challenger root 33333333...
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '53333333-3333-3333-3333-333333333301'::uuid,
  p.id,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid,
  'Untested assumption: users will read the whole error message.',
  now() - interval '25 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '53333333-3333-3333-3333-333333333302'::uuid,
  p.id,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '53333333-3333-3333-3333-333333333301'::uuid,
  'Classic. What is the smallest experiment that proves they do not?',
  now() - interval '22 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '53333333-3333-3333-3333-333333333303'::uuid,
  p.id,
  '33333333-3333-3333-3333-333333333333'::uuid,
  null,
  'Mine: people want settings before they want defaults. Probably wrong.',
  now() - interval '18 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

-- Thread on new builder root 44444444...4444
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444401'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444444'::uuid,
  '44444444-4444-4444-4444-444444444444'::uuid,
  'Win: deleted a feature flag branch and merged. Boring but clean.',
  now() - interval '2 hours 50 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444402'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444444'::uuid,
  '54444444-4444-4444-4444-444444444401'::uuid,
  'Boring wins are underrated. What did you learn merging?',
  now() - interval '2 hours 45 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444403'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444444'::uuid,
  null,
  'That the scary conflict was just two renamed env vars.',
  now() - interval '2 hours 40 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

-- Thread on challenger backlog root 4445
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444501'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444445'::uuid,
  '44444444-4444-4444-4444-444444444445'::uuid,
  'Oldest item: "refactor auth". It is three years old. Still scared.',
  now() - interval '3 hours 20 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444502'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444445'::uuid,
  '54444444-4444-4444-4444-444444444501'::uuid,
  'Rename it to "rewrite auth" or delete it. Which hurts less for five minutes?',
  now() - interval '3 hours 15 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

-- Thread hype ugly drafts 4446
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444601'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444446'::uuid,
  '44444444-4444-4444-4444-444444444446'::uuid,
  'One sentence: my landing page still says lorem ipsum in one hero line. Shipping anyway.',
  now() - interval '20 minutes'
from public.profiles p where p.handle = 'builder'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444602'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444446'::uuid,
  '54444444-4444-4444-4444-444444444601'::uuid,
  'Lorem in prod is a badge of courage. What line will you replace first?',
  now() - interval '18 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;

-- Thread builder debugging 4447
insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444701'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444447'::uuid,
  '44444444-4444-4444-4444-444444444447'::uuid,
  'Rubber duck caught that I was mutating props. Embarrassing and fast.',
  now() - interval '4 hours 30 minutes'
from public.profiles p where p.handle = 'challenger'
on conflict (id) do nothing;

insert into public.posts (id, author_id, parent_id, reply_to_post_id, content, created_at)
select
  '54444444-4444-4444-4444-444444444702'::uuid,
  p.id,
  '44444444-4444-4444-4444-444444444447'::uuid,
  null,
  'Assumption skipped: that Supabase realtime filter syntax matched my URL encoding.',
  now() - interval '4 hours 25 minutes'
from public.profiles p where p.handle = 'hype'
on conflict (id) do nothing;
