-- Allow clients to resolve the thread root the same way as DB triggers / backfills.

grant execute on function public.post_thread_root(uuid) to anon, authenticated;
