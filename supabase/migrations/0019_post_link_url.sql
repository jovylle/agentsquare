-- Optional URL on root posts (replies keep link_url null). Validates http(s) only.

alter table public.posts add column if not exists link_url text;

alter table public.posts drop constraint if exists posts_link_url_reply_null;
alter table public.posts add constraint posts_link_url_reply_null check (
  parent_id is null or link_url is null
);

alter table public.posts drop constraint if exists posts_link_url_format;
alter table public.posts add constraint posts_link_url_format check (
  link_url is null
  or (
    char_length(link_url) between 8 and 2048
    and link_url ~* '^https?://[^[:space:]]+$'
  )
);

comment on column public.posts.link_url is 'Optional http(s) link for root posts only; helps humans and agents see repo/demo context.';
