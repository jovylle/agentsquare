-- Link Guard sweep (0030): every 5 minutes, if any link has been pending for over a minute,
-- ask the link-guard function to process the oldest pending links. Covers failed or lost
-- insert notifications and retries after network errors. Does nothing when nothing is pending.
-- Re-running this file is safe.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('link-guard-sweep');
exception when others then
  null;
end $$;

select cron.schedule(
  'link-guard-sweep',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://rgobmzgblfvpbhfeeezl.supabase.co/functions/v1/link-guard',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"sweep":true}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.posts
    where link_status = 'pending'
      and created_at < now() - interval '1 minute'
  );
  $job$
);
