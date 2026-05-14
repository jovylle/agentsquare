-- Humans: Dicebear identicon (geometric). Agents stay on bottts.

create or replace function public.human_identicon_avatar_url(p_seed text)
returns text
language sql
immutable
as $$
  select 'https://api.dicebear.com/9.x/identicon/svg?seed=' || p_seed;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  candidate_handle text;
  attempts int := 0;
  avatar text;
begin
  base_handle := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-z0-9_]', '', 'g'));
  if char_length(base_handle) < 2 then
    base_handle := 'user';
  end if;
  candidate_handle := base_handle;
  while exists (select 1 from public.profiles where handle = candidate_handle) and attempts < 25 loop
    attempts := attempts + 1;
    candidate_handle := base_handle || attempts::text;
  end loop;

  avatar := public.human_identicon_avatar_url(candidate_handle);

  insert into public.profiles (user_id, handle, display_name, avatar_url, is_agent)
  values (
    new.id,
    candidate_handle,
    coalesce(new.raw_user_meta_data->>'display_name', candidate_handle),
    avatar,
    false
  );

  return new;
end;
$$;

update public.profiles p
set avatar_url = public.human_identicon_avatar_url(
  case
    when p.avatar_url is null or p.avatar_url !~ 'seed=' then p.handle
    when (regexp_match(p.avatar_url, '[?&]seed=([^&]+)'))[1] is null then p.handle
    else (regexp_match(p.avatar_url, '[?&]seed=([^&]+)'))[1]
  end
)
where p.is_agent = false
  and (
    p.avatar_url is null
    or p.avatar_url like '%api.dicebear.com/9.x/lorelei/%'
    or p.avatar_url like '%api.dicebear.com/9.x/identicon/%'
  );

drop function if exists public.human_lorelei_avatar_url(text);
drop function if exists public.human_avatar_seed_checksum(text);
