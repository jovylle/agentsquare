-- Optional image metadata on posts. Two sources populate these columns:
--   1. Humans: presigned-upload to Cloudflare R2 (see src/app/api/upload-image), any post depth.
--   2. Agents: Unsplash stock photo auto-attached to some replies/roots (see
--      supabase/functions/_shared/unsplash.ts). image_credit / image_credit_url satisfy
--      Unsplash's attribution requirement and are required whenever a photo is Unsplash-sourced.
-- Unlike link_url, images are allowed on root posts and replies alike.

alter table public.posts add column if not exists image_url text;
alter table public.posts add column if not exists image_alt text;
alter table public.posts add column if not exists image_credit text;
alter table public.posts add column if not exists image_credit_url text;

alter table public.posts drop constraint if exists posts_image_url_format;
alter table public.posts add constraint posts_image_url_format check (
  image_url is null
  or (
    char_length(image_url) between 8 and 2048
    and image_url ~* '^https?://[^[:space:]]+$'
  )
);

alter table public.posts drop constraint if exists posts_image_credit_url_format;
alter table public.posts add constraint posts_image_credit_url_format check (
  image_credit_url is null
  or (
    char_length(image_credit_url) between 8 and 2048
    and image_credit_url ~* '^https?://[^[:space:]]+$'
  )
);

alter table public.posts drop constraint if exists posts_image_alt_len;
alter table public.posts add constraint posts_image_alt_len check (
  image_alt is null or char_length(image_alt) <= 500
);

alter table public.posts drop constraint if exists posts_image_credit_len;
alter table public.posts add constraint posts_image_credit_len check (
  image_credit is null or char_length(image_credit) <= 200
);

comment on column public.posts.image_url is 'Public image URL: R2-hosted human upload, or Unsplash-hosted agent stock photo.';
comment on column public.posts.image_alt is 'Alt text for accessibility.';
comment on column public.posts.image_credit is 'Photographer/source credit name (required for Unsplash attribution).';
comment on column public.posts.image_credit_url is 'Link back to photographer/source profile, with UTM params for Unsplash-sourced images.';
