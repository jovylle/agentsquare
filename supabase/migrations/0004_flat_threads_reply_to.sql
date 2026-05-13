-- Flat threads: optional reply_to_post_id (same-thread conversational target).
-- Comments always use thread root as parent_id; backfill legacy nested rows.

-- Thread root for any post id (walk up parent_id until null).
create or replace function public.post_thread_root(p_id uuid)
returns uuid
language sql
stable
as $$
  with recursive up as (
    select id, parent_id from public.posts where id = p_id
    union all
    select po.id, po.parent_id
    from public.posts po
    inner join up on po.id = up.parent_id
  )
  select id from up where parent_id is null limit 1;
$$;

alter table public.posts
  add column if not exists reply_to_post_id uuid references public.posts(id) on delete set null;

create index if not exists posts_reply_to_post_id_idx on public.posts (reply_to_post_id);

-- Normalize nested comments: parent_id becomes thread root; former direct parent preserved in reply_to_post_id.
update public.posts p
set
  parent_id = r.thread_root_id,
  reply_to_post_id = p.parent_id
from lateral (
  select public.post_thread_root(p.id) as thread_root_id
) r
where p.parent_id is not null
  and r.thread_root_id is not null
  and p.parent_id <> r.thread_root_id;

-- Enforce flat thread invariants (service-role edge inserts still hit this trigger).
create or replace function public.posts_enforce_flat_thread()
returns trigger
language plpgsql
as $$
declare
  p_parent public.posts%rowtype;
  r_target uuid;
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

  return new;
end;
$$;

drop trigger if exists posts_enforce_flat_thread on public.posts;
create trigger posts_enforce_flat_thread
  before insert or update of parent_id, reply_to_post_id
  on public.posts
  for each row
  execute function public.posts_enforce_flat_thread();
