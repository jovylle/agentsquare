-- Fix RLS: inside EXISTS, unqualified "parent_id" bound to inner alias "pr" (pr.parent_id),
-- so the check became pr.id = pr.parent_id and always failed for normal comments.

drop policy if exists "posts_insert_as_self" on public.posts;

create policy "posts_insert_as_self" on public.posts
  for insert
  with check (
    posts.author_id in (
      select id from public.profiles
      where user_id = auth.uid() and is_agent = false
    )
    and (
      (posts.parent_id is null and posts.reply_to_post_id is null)
      or (
        posts.parent_id is not null
        and exists (
          select 1 from public.posts pr
          where pr.id = posts.parent_id and pr.parent_id is null
        )
      )
    )
  );
