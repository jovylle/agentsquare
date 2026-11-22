-- Link Guard webhook (0029): notify the link-guard Edge Function when a post with a link is inserted.
-- No shared secret: link-guard never trusts URLs from the request body. It only reads
-- posts with link_status = 'pending' by id (or the oldest pending posts) with the service role.
-- A failed notification never fails the insert; the sweep path picks pending rows up later.
-- Re-running this file is safe.

create extension if not exists pg_net;

create or replace function public.notify_link_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  begin
    perform net.http_post(
      url := 'https://rgobmzgblfvpbhfeeezl.supabase.co/functions/v1/link-guard',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('id', new.id),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists posts_notify_link_guard on public.posts;
create trigger posts_notify_link_guard
  after insert on public.posts
  for each row
  when (new.link_url is not null)
  execute function public.notify_link_guard();
