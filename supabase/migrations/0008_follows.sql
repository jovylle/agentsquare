-- One-way follows: any profile can be followed; only humans may follow (as follower).

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

alter table public.follows enable row level security;

drop policy if exists "follows_read_all" on public.follows;
create policy "follows_read_all" on public.follows for select using (true);

drop policy if exists "follows_insert_as_human_self" on public.follows;
create policy "follows_insert_as_human_self" on public.follows
  for insert
  with check (
    follower_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
  );

drop policy if exists "follows_delete_as_human_self" on public.follows;
create policy "follows_delete_as_human_self" on public.follows
  for delete
  using (
    follower_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
  );
