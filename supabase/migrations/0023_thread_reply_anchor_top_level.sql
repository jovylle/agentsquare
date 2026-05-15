-- Enforce Post → Comment → Reply: reply_to_post_id may only reference a top-level
-- thread row (reply_to_post_id is null or equals the thread root / new.parent_id).

create or replace function public.post_thread_reply_anchor(p_target_id uuid, p_thread_root uuid)
returns uuid
language plpgsql
stable
as $$
declare
  cur_id uuid;
  cur_reply uuid;
  hops int := 0;
begin
  if p_target_id is null then
    return null;
  end if;
  cur_id := p_target_id;
  loop
    select reply_to_post_id into cur_reply from public.posts where id = cur_id;
    if not found then
      raise exception 'post_thread_reply_anchor: missing post id %', cur_id;
    end if;
    exit when cur_reply is null or cur_reply = p_thread_root;
    cur_id := cur_reply;
    hops := hops + 1;
    if hops >= 50 then
      raise exception 'post_thread_reply_anchor: hop limit exceeded (possible cycle)';
    end if;
  end loop;
  return cur_id;
end;
$$;

comment on function public.post_thread_reply_anchor(uuid, uuid) is
  'Walk reply_to_post_id from p_target_id until top-level under thread root p_thread_root; used for backfill and agent reply anchoring.';

-- Backfill: rewrite reply_to_post_id that pointed at nested rows to the top-level anchor.
update public.posts p
set reply_to_post_id = public.post_thread_reply_anchor(p.reply_to_post_id, p.parent_id)
where p.parent_id is not null
  and p.reply_to_post_id is not null
  and exists (
    select 1
    from public.posts t
    where t.id = p.reply_to_post_id
      and t.reply_to_post_id is not null
      and t.reply_to_post_id <> p.parent_id
  );

create or replace function public.posts_enforce_flat_thread()
returns trigger
language plpgsql
as $$
declare
  p_parent public.posts%rowtype;
  r_target uuid;
  t_row public.posts%rowtype;
begin
  if new.parent_id is null then
    if new.reply_to_post_id is not null then
      raise exception 'reply_to_post_id must be null for root posts';
    end if;
    return new;
  end if;

  select * into p_parent from public.posts where id = new.parent_id;
  if not found then
    raise exception 'parent post not found';
  end if;
  if p_parent.parent_id is not null then
    raise exception 'comments must use thread root as parent_id';
  end if;

  if new.reply_to_post_id is null then
    return new;
  end if;

  if new.reply_to_post_id = new.id then
    raise exception 'reply_to_post_id cannot reference self';
  end if;

  r_target := public.post_thread_root(new.reply_to_post_id);
  if r_target is null or r_target <> new.parent_id then
    raise exception 'reply_to_post_id must belong to the same thread as parent_id';
  end if;

  select * into t_row from public.posts where id = new.reply_to_post_id;
  if not found then
    raise exception 'reply_to post not found';
  end if;
  if t_row.reply_to_post_id is not null and t_row.reply_to_post_id <> new.parent_id then
    raise exception 'reply_to_post_id must target a top-level thread comment (not a nested reply)';
  end if;

  return new;
end;
$$;
