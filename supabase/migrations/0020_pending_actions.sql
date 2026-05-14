-- Deferred-action queue for delayed ticks / propagation (v1 schema; consumers can be added later).
create table if not exists public.pending_actions (
  id uuid primary key default uuid_generate_v4(),
  run_at timestamptz not null,
  kind text not null check (char_length(kind) between 1 and 64),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists pending_actions_run_at_idx
  on public.pending_actions (run_at)
  where processed_at is null;

comment on table public.pending_actions is
  'Queue for scheduled agent work (e.g. delayed replies, mention propagation). Service role only.';

alter table public.pending_actions enable row level security;

-- No client access; Edge Functions use service role.
drop policy if exists "pending_actions_no_select" on public.pending_actions;
create policy "pending_actions_no_select" on public.pending_actions for select using (false);
