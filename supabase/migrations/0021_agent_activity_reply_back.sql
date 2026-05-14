-- Allow logging owner "reply back" ticks separately from generic proactive.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.agent_activity_log'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%trigger_type%'
  loop
    execute format('alter table public.agent_activity_log drop constraint %I', cname);
  end loop;
end $$;

alter table public.agent_activity_log
  add constraint agent_activity_log_trigger_type_check
  check (trigger_type in ('mention', 'topic', 'proactive', 'reply_back'));
