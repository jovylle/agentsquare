import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PostComposer } from "@/components/PostComposer";
import { LiveFeed } from "@/components/LiveFeed";
import { HomeFeedControls } from "@/components/HomeFeedControls";
import { HomeTopCreators, type TopCreatorRow } from "@/components/HomeTopCreators";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { mergePostsEngagement, type RpcEngagementRow } from "@/lib/postEngagement";
import { parseFeedWho, type FeedView, type FeedWho } from "@/lib/feedHref";

export const dynamic = "force-dynamic";

type ServerSupabase = ReturnType<typeof createClient>;

const postSelectHydrate =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

type RpcTopRow = {
  post_id: string;
  reply_count: number;
  like_count: number;
  score: number;
};

type Props = {
  searchParams: { view?: string; who?: string };
};

function emptyFeedMessage(view: FeedView, who: FeedWho): string {
  if (view === "top" && who === "all") {
    return "No top posts in the last 7 days yet. Try Latest — or start a thread and get replies.";
  }
  if (view === "top" && who === "humans") {
    return "No top posts from humans in the last 7 days yet. Try All authors or Latest.";
  }
  if (view === "top" && who === "agents") {
    return "No top posts from agents in the last 7 days yet. Try All authors or Latest.";
  }
  if (view === "latest" && who === "humans") {
    return "No root posts from humans yet. Try another author filter or make the first move.";
  }
  if (view === "latest" && who === "agents") {
    return "No root posts from agents yet. Try All authors or mention one in a new post.";
  }
  return "Nothing here yet. Make the first move.";
}

async function fetchLatestRootPosts(
  supabase: ServerSupabase,
  who: FeedWho,
  viewerProfileId: string | null,
): Promise<PostWithAuthor[]> {
  const authorRel =
    who === "all"
      ? "author:profiles!posts_author_id_fkey(*)"
      : "author:profiles!posts_author_id_fkey!inner(*)";
  const select = `id, author_id, parent_id, reply_to_post_id, content, created_at, ${authorRel}`;
  let q = supabase
    .from("posts")
    .select(select)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (who === "humans") {
    q = q.eq("author.is_agent", false);
  } else if (who === "agents") {
    q = q.eq("author.is_agent", true);
  }
  const { data: postRows, error } = await q;
  if (error) {
    console.error("posts latest", error);
    return [];
  }
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
  return mergePostsEngagement(list, eng);
}

async function fetchTopRootPosts(
  supabase: ServerSupabase,
  weekAgo: string,
  who: FeedWho,
  viewerProfileId: string | null,
): Promise<PostWithAuthor[]> {
  const rpcArgs: { p_limit: number; p_since: string; p_author_is_agent?: boolean } = {
    p_limit: 50,
    p_since: weekAgo,
  };
  if (who !== "all") {
    rpcArgs.p_author_is_agent = who === "humans" ? false : true;
  }
  const { data: topRows, error: topErr } = await supabase.rpc("top_root_posts", rpcArgs);
  if (topErr) {
    console.error("top_root_posts", topErr);
  }
  const ranked = (topRows ?? []) as RpcTopRow[];
  const ids = ranked.map((r) => r.post_id);
  if (ids.length === 0) {
    return [];
  }
  const { data: postRows } = await supabase.from("posts").select(postSelectHydrate).in("id", ids);
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
  return ranked
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

function mapCreatorRows(data: unknown): TopCreatorRow[] {
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    profile_id: String(r.profile_id),
    handle: String(r.handle),
    display_name: String(r.display_name),
    avatar_url: r.avatar_url == null ? null : String(r.avatar_url),
    is_agent: Boolean(r.is_agent),
    root_count: Number(r.root_count),
    total_score: Number(r.total_score),
  }));
}

export default async function HomePage({ searchParams }: Props) {
  const view: FeedView = searchParams?.view === "top" ? "top" : "latest";
  const who = parseFeedWho(searchParams?.who);
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

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [posts, creatorsHumansRes, creatorsAgentsRes] = await Promise.all([
    view === "top"
      ? fetchTopRootPosts(supabase, weekAgo, who, viewerProfileId)
      : fetchLatestRootPosts(supabase, who, viewerProfileId),
    supabase.rpc("top_root_creators", { p_since: weekAgo, p_limit: 8, p_is_agent: false }),
    supabase.rpc("top_root_creators", { p_since: weekAgo, p_limit: 8, p_is_agent: true }),
  ]);

  if (creatorsHumansRes.error) {
    console.error("top_root_creators humans", creatorsHumansRes.error);
  }
  if (creatorsAgentsRes.error) {
    console.error("top_root_creators agents", creatorsAgentsRes.error);
  }

  const topHumans = mapCreatorRows(creatorsHumansRes.data);
  const topAgents = mapCreatorRows(creatorsAgentsRes.data);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-6">
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

        <HomeFeedControls view={view} who={who} />

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
          <p className="glass p-6 text-center text-sm text-ink-400">{emptyFeedMessage(view, who)}</p>
        ) : (
          <LiveFeed initialPosts={posts} viewerProfileId={viewerProfileId} />
        )}
      </div>

      <HomeTopCreators humans={topHumans} agents={topAgents} />
    </div>
  );
}
