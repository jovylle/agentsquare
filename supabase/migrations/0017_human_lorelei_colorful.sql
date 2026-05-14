-- Colorful Lorelei avatars + tighter crop; checksum-based flip/rotate (must match src/lib/humanAvatarPresets.ts).

create or replace function public.human_avatar_seed_checksum(p_seed text)
returns integer
language plpgsql
immutable
as $$
declare
  i int;
  s int := 0;
begin
  for i in 1..length(p_seed) loop
    s := s + ascii(substr(p_seed, i, 1));
  end loop;
  return s;
end;
$$;

create or replace function public.human_lorelei_avatar_url(p_seed text)
returns text
language plpgsql
immutable
as $$
declare
  chk int;
  flip boolean;
  rot int;
  tilts int[] := array[-8, -4, 0, 4, 8];
  bg text := 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,f5d0c5,e8c5ff,a8e6cf,fceabb,ffb4a2,c1f7dc,89c2d9,f4acb7';
  hair text := '4a3728,2c1810,8b4513,d87a5c,6b5b95,3d5a80,c9a227,e8b4a0,f4a6b0,a67c52,6f4e37,5c4d7d,2d6a4f';
  skin text := 'f8d9c4,f5cbb4,e8b89c,d4a574,ffe4d6,edc9af,c68642,f0c8a8,deb887';
  mouth text := 'd4a574,c97b63,e8a090,b85c4e,f4a698,9e6b5c';
  brows text := '4a3728,6b4423,8b6914,5c4033,3d2914';
  eyes text := '2e5266,4a6741,6b4e71,3d5a80,8b4513,2f4f4f';
begin
  chk := public.human_avatar_seed_checksum(p_seed);
  flip := (chk % 2) = 1;
  rot := tilts[1 + (chk % array_length(tilts, 1))];

  return 'https://api.dicebear.com/9.x/lorelei/svg?seed=' || p_seed
    || '&backgroundType=gradientLinear,solid'
    || '&backgroundColor=' || bg
    || '&backgroundRotation=0,360'
    || '&hairColor=' || hair
    || '&skinColor=' || skin
    || '&mouthColor=' || mouth
    || '&eyebrowsColor=' || brows
    || '&eyesColor=' || eyes
    || '&scale=120'
    || '&translateY=-16'
    || '&rotate=' || rot::text
    || case when flip then '&flip=true' else '&flip=false' end;
end;
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

  avatar := public.human_lorelei_avatar_url(candidate_handle);

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

-- Refresh human lorelei URLs (new colors / crop / tilt).
update public.profiles p
set avatar_url = public.human_lorelei_avatar_url(
  case
    when p.avatar_url is null or p.avatar_url !~ 'seed=' then p.handle
    when (regexp_match(p.avatar_url, '[?&]seed=([^&]+)'))[1] is null then p.handle
    else (regexp_match(p.avatar_url, '[?&]seed=([^&]+)'))[1]
  end
)
where p.is_agent = false
  and (
    p.avatar_url is null
    or p.avatar_url like '%api.dicebear.com/9.x/lorelei/svg%'
  );
