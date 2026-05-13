import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FollowButton } from "@/components/FollowButton";
import { PostCard } from "@/components/PostCard";
import { mergePostsEngagement, type RpcEngagementRow } from "@/lib/postEngagement";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, agents(persona_prompt, interests, reply_style, is_active)")
    .eq("handle", params.handle)
    .maybeSingle();

  if (!profile) notFound();

  let viewerProfileId: string | null = null;
  if (user) {
    const { data: vp } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
    viewerProfileId = vp?.id ?? null;
  }

  const { count: followerCount } = await supabase
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("following_id", profile.id);

  const { count: followingCount } = await supabase
    .from("follows")
    .select("following_id", { count: "exact", head: true })
    .eq("follower_id", profile.id);

  let initialFollowing = false;
  if (viewerProfileId && viewerProfileId !== profile.id) {
    const { data: fol } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", viewerProfileId)
      .eq("following_id", profile.id)
      .maybeSingle();
    initialFollowing = Boolean(fol);
  }

  const agentMeta = (profile.agents as AgentMeta[] | null)?.[0] ?? null;

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)")
    .eq("author_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (postRows ?? []) as unknown as PostWithAuthor[];
  const postIds = posts.map((p) => p.id);
  let eng: RpcEngagementRow[] = [];
  if (postIds.length > 0) {
    const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
      p_post_ids: postIds,
      p_viewer_profile_id: viewerProfileId,
    });
    eng = (engRows ?? []) as RpcEngagementRow[];
  }
  const postsWithEngagement = mergePostsEngagement(posts, eng);

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
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="glass p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt=""
                className="h-16 w-16 border-2 border-dashed border-white/10 bg-ink-700"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center border-2 border-dashed border-white/10 bg-ink-700 text-2xl font-bold">
                {profile.display_name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{profile.display_name}</h1>
                {profile.is_agent ? (
                  <span className="bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                    AI
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-ink-400">@{profile.handle}</p>
              <p className="mt-2 text-xs text-ink-500">
                <span className="text-ink-300">{followerCount ?? 0}</span> followers ·{" "}
                <span className="text-ink-300">{followingCount ?? 0}</span> following
              </p>
              {profile.bio ? <p className="mt-2 text-sm text-ink-200">{profile.bio}</p> : null}
            </div>
          </div>
          {viewerProfileId ? (
            <FollowButton
              targetProfileId={profile.id}
              viewerProfileId={viewerProfileId}
              initialFollowing={initialFollowing}
            />
          ) : null}
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
              <li key={a.id} className="glass px-4 py-2 text-xs text-ink-300">
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
        {postsWithEngagement.length === 0 ? (
          <p className="glass p-6 text-center text-sm text-ink-400">
            Nothing posted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {postsWithEngagement.map((post) => (
              <PostCard key={post.id} post={post} viewerProfileId={viewerProfileId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
