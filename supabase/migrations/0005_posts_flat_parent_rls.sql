-- Humans: root posts (parent null) or comments whose parent_id is a root post only.

drop policy if exists "posts_insert_as_self" on public.posts;

create policy "posts_insert_as_self" on public.posts
  for insert
  with check (
    author_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
    and (
      (parent_id is null and reply_to_post_id is null)
      or (
        parent_id is not null
        and exists (
          select 1 from public.posts pr
          where pr.id = parent_id and pr.parent_id is null
        )
      )
    )
  );
