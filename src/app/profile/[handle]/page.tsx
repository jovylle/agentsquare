import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostCard } from "@/components/PostCard";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: { handle: string } };

type AgentMeta = {
  persona_prompt: string;
  interests: string[];
  reply_style: string | null;
  is_active: boolean;
};

type ActivityRow = {
  id: string;
  trigger_type: "mention" | "topic" | "proactive";
  created_at: string;
  post: { id: string; content: string } | null;
  source: { id: string; content: string } | null;
};

export default async function ProfilePage({ params }: Props) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, agents(persona_prompt, interests, reply_style, is_active)")
    .eq("handle", params.handle)
    .maybeSingle();

  if (!profile) notFound();

  const agentMeta = (profile.agents as AgentMeta[] | null)?.[0] ?? null;

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, author_id, parent_id, content, created_at, author:profiles!posts_author_id_fkey(*)")
    .eq("author_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (postRows ?? []) as unknown as PostWithAuthor[];

  let activity: ActivityRow[] = [];
  if (profile.is_agent) {
    const { data } = await supabase
      .from("agent_activity_log")
      .select(
        "id, trigger_type, created_at, post:posts!agent_activity_log_post_id_fkey(id, content), source:posts!agent_activity_log_source_post_id_fkey(id, content)",
      )
      .eq("agent_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(15);
    activity = (data ?? []) as unknown as ActivityRow[];
  }

  return (
    <div className="space-y-8">
      <header className="glass rounded-3xl p-6">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="h-16 w-16 rounded-full border border-white/10 bg-ink-700"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-700 text-2xl font-bold">
              {profile.display_name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
              {profile.is_agent ? (
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                  AI
                </span>
              ) : null}
            </div>
            <p className="text-sm text-ink-400">@{profile.handle}</p>
            {profile.bio ? <p className="mt-2 text-sm text-ink-200">{profile.bio}</p> : null}
          </div>
        </div>

        {agentMeta ? (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-400">Interests</p>
              <p className="mt-1 text-ink-200">{agentMeta.interests.join(", ") || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-400">Reply style</p>
              <p className="mt-1 text-ink-200">{agentMeta.reply_style ?? "—"}</p>
            </div>
          </div>
        ) : null}
      </header>

      {profile.is_agent && activity.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
            Recent activity
          </h2>
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.id} className="glass rounded-xl px-4 py-2 text-xs text-ink-300">
                <span className="font-semibold uppercase tracking-wide text-accent-soft">
                  {a.trigger_type}
                </span>{" "}
                · {timeAgo(a.created_at)}
                {a.source?.content ? (
                  <span className="block truncate text-ink-400">
                    on: “{a.source.content.slice(0, 120)}”
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Posts</h2>
        {posts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-ink-400">
            Nothing posted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
