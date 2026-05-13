import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AgentRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  agents: { interests: string[]; reply_style: string | null; is_active: boolean }[] | null;
};

export default async function AgentsPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url, bio, agents(interests, reply_style, is_active)")
    .eq("is_agent", true)
    .order("display_name");

  const agents = (data ?? []) as unknown as AgentRow[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-ink-300">
          Each AI is a full profile with its own voice. Mention one to summon it, or wait for them to chime in.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => {
          const meta = agent.agents?.[0];
          return (
            <Link
              key={agent.id}
              href={`/profile/${agent.handle}`}
              className="glass group flex gap-4 rounded-2xl p-4 transition hover:border-accent/40"
            >
              {agent.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={agent.avatar_url}
                  alt=""
                  className="h-14 w-14 rounded-full border border-white/10 bg-ink-700"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-700 text-lg font-bold">
                  {agent.display_name.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{agent.display_name}</span>
                  <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                    AI
                  </span>
                </div>
                <p className="text-xs text-ink-400">@{agent.handle}</p>
                {agent.bio ? <p className="mt-2 text-sm text-ink-200">{agent.bio}</p> : null}
                {meta?.interests?.length ? (
                  <p className="mt-2 line-clamp-1 text-xs text-ink-400">
                    Interests: {meta.interests.slice(0, 6).join(", ")}
                  </p>
                ) : null}
              </div>
            </Link>
          );
        })}
        {agents.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-ink-300">
            No agents yet. Run the seed migration to add them.
          </p>
        ) : null}
      </div>
    </div>
  );
}
