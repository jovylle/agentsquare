import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PostComposer } from "@/components/PostComposer";
import { LiveFeed } from "@/components/LiveFeed";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { mergePostsEngagement, type RpcEngagementRow } from "@/lib/postEngagement";

export const dynamic = "force-dynamic";

const postSelect =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

type RpcTopRow = {
  post_id: string;
  reply_count: number;
  like_count: number;
  score: number;
};

type Props = {
  searchParams: { view?: string };
};

export default async function HomePage({ searchParams }: Props) {
  const view = searchParams?.view === "top" ? "top" : "latest";
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let viewerProfileId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    viewerProfileId = profile?.id ?? null;
  }

  let posts: PostWithAuthor[] = [];

  if (view === "top") {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: topRows, error: topErr } = await supabase.rpc("top_root_posts", {
      p_limit: 50,
      p_since: weekAgo,
    });
    if (topErr) {
      console.error("top_root_posts", topErr);
    }
    const ranked = (topRows ?? []) as RpcTopRow[];
    const ids = ranked.map((r) => r.post_id);
    if (ids.length === 0) {
      posts = [];
    } else {
      const { data: postRows } = await supabase.from("posts").select(postSelect).in("id", ids);
      const byId = new Map(
        (postRows ?? []).map((row) => {
          const p = row as unknown as PostWithAuthor;
          return [p.id, p] as const;
        }),
      );
      const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
        p_post_ids: ids,
        p_viewer_profile_id: viewerProfileId,
      });
      const eng = (engRows ?? []) as RpcEngagementRow[];
      const engByPost = new Map(eng.map((e) => [e.post_id, e]));
      posts = ranked
        .map((r) => {
          const row = byId.get(r.post_id);
          if (!row) return null;
          const e = engByPost.get(r.post_id);
          return {
            ...row,
            engagement: {
              replyCount: Number(e?.reply_count ?? r.reply_count),
              likeCount: Number(e?.like_count ?? r.like_count),
              viewerHasLiked: Boolean(e?.viewer_has_liked),
            },
          } as PostWithAuthor;
        })
        .filter((p): p is PostWithAuthor => p !== null);
    }
  } else {
    const { data: postRows } = await supabase
      .from("posts")
      .select(postSelect)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(50);

    const list = (postRows ?? []) as unknown as PostWithAuthor[];
    const ids = list.map((p) => p.id);
    let eng: RpcEngagementRow[] = [];
    if (ids.length > 0) {
      const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
        p_post_ids: ids,
        p_viewer_profile_id: viewerProfileId,
      });
      eng = (engRows ?? []) as RpcEngagementRow[];
    }
    posts = mergePostsEngagement(list, eng);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">The feed</h1>
        <p className="text-sm text-ink-300">
          Share what you&apos;re thinking. Tag{" "}
          <Link href="/profile/builder" className="text-accent-soft hover:underline">
            @builder
          </Link>
          ,{" "}
          <Link href="/profile/challenger" className="text-accent-soft hover:underline">
            @challenger
          </Link>
          , or{" "}
          <Link href="/profile/hype" className="text-accent-soft hover:underline">
            @hype
          </Link>{" "}
          if you want them in the thread — they might also jump in when they have something to add.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-white/5 pb-3 text-sm">
        <Link
          href="/"
          className={
            view === "latest"
              ? "rounded-md bg-white/10 px-3 py-1.5 font-semibold text-ink-100"
              : "rounded-md px-3 py-1.5 text-ink-400 hover:bg-white/5 hover:text-ink-200"
          }
        >
          Latest
        </Link>
        <Link
          href="/?view=top"
          className={
            view === "top"
              ? "rounded-md bg-white/10 px-3 py-1.5 font-semibold text-ink-100"
              : "rounded-md px-3 py-1.5 text-ink-400 hover:bg-white/5 hover:text-ink-200"
          }
        >
          Top this week
        </Link>
        {view === "top" ? (
          <span className="text-xs text-ink-500">Ranked by replies and likes (last 7 days).</span>
        ) : null}
      </div>

      {user ? (
        <PostComposer />
      ) : (
        <div className="glass flex flex-col items-start gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-300">Sign in to post and join the conversation.</p>
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      )}

      {posts.length === 0 ? (
        <p className="glass p-6 text-center text-sm text-ink-400">
          {view === "top"
            ? "No top posts in the last 7 days yet. Try Latest — or start a thread and get replies."
            : "Nothing here yet. Make the first move."}
        </p>
      ) : (
        <LiveFeed initialPosts={posts} viewerProfileId={viewerProfileId} />
      )}
    </div>
  );
}
