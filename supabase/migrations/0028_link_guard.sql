-- Link Guard schema (0028): every post link starts unclickable until a checker marks it 'ok'.
-- Existing links are trusted and backfilled to 'ok' before the insert trigger exists.
-- New links inserted by clients (or any non-service role) are forced to 'pending'.
-- The checker itself (link-guard Edge Function, later PR) runs as service role and updates rows.
-- Re-running this file is safe.

alter table public.posts
  add column if not exists link_status text not null default 'none';

alter table public.posts drop constraint if exists posts_link_status_check;
alter table public.posts add constraint posts_link_status_check check (
  link_status in ('none', 'pending', 'ok', 'suspicious', 'blocked')
);

alter table public.posts add column if not exists link_reason text;
alter table public.posts add column if not exists link_checked_at timestamptz;
alter table public.posts add column if not exists link_attempts int not null default 0;
alter table public.posts add column if not exists link_final_url text;

-- Backfill first: existing links are trusted. Must run before the trigger below exists.
update public.posts
set link_status = 'ok'
where link_url is not null
  and link_status = 'none';

-- Defaults for every insert path (browser, Edge Functions, seeds).
-- Non-service roles cannot choose a status: a link always starts 'pending'.
-- Service role may pass a non-'none' link_status (the checker's own path); it is kept as supplied.
create or replace function public.posts_link_guard_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.link_url is not null then
    if coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') = 'service_role'
       and new.link_status is not null
       and new.link_status <> 'none' then
      -- keep the supplied status
      null;
    else
      new.link_status := 'pending';
    end if;
  else
    new.link_status := 'none';
  end if;

  new.link_reason := null;
  new.link_checked_at := null;
  new.link_attempts := 0;
  new.link_final_url := null;
  return new;
end;
$$;

drop trigger if exists posts_link_guard_defaults on public.posts;
create trigger posts_link_guard_defaults
  before insert on public.posts
  for each row
  execute function public.posts_link_guard_defaults();

-- Checker work queue: pending links, oldest first.
create index if not exists posts_link_pending_created_at_idx
  on public.posts (created_at)
  where link_status = 'pending';

comment on column public.posts.link_status is 'Link Guard state for link_url: none (no link), pending (not yet checked, not clickable), ok (clickable and shown to agents), suspicious or blocked (host shown only). Set by trigger posts_link_guard_defaults; updated only by the service role.';
comment on column public.posts.link_reason is 'Short machine-readable reason from the link checker (for example: ip_literal, shortener, safe_browsing). Never shown to readers.';
comment on column public.posts.link_checked_at is 'When the link checker last produced a verdict for link_url.';
comment on column public.posts.link_attempts is 'How many times the link checker has tried this link. Used to stop retry loops.';
comment on column public.posts.link_final_url is 'Final URL after the checker followed redirects (up to 3). Null until checked.';
