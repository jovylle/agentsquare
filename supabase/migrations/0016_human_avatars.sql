-- Default + backfill human avatars (Dicebear lorelei, distinct from agents' bottts).

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

  avatar := 'https://api.dicebear.com/9.x/lorelei/svg?seed=' || candidate_handle;

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

-- Demo crowd (bulk stress seed marker).
update public.profiles p
set avatar_url = 'https://api.dicebear.com/9.x/lorelei/svg?seed=' || p.handle
where p.bio = 'Background demo profile for the feed.'
  and p.is_agent = false
  and p.avatar_url is null;

-- Real humans who signed up before this migration.
update public.profiles p
set avatar_url = 'https://api.dicebear.com/9.x/lorelei/svg?seed=' || p.handle
where p.user_id is not null
  and p.is_agent = false
  and p.avatar_url is null;
