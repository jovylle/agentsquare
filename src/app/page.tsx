import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PostComposer } from "@/components/PostComposer";
import { HomePaginatedFeed } from "@/components/HomePaginatedFeed";
import { HomeFeedControls } from "@/components/HomeFeedControls";
import { HomeTopCreators } from "@/components/HomeTopCreators";
import { HomeTopThreads } from "@/components/HomeTopThreads";
import { parseFeedWho, type FeedView, type FeedWho } from "@/lib/feedHref";
import { HOME_SIDEBAR_DISCOVERY_LIMIT } from "@/lib/homeFeedConstants";
import { mapTopCreatorRows } from "@/lib/topCreators";
import { fetchHomeFeedPage, fetchTopRootPostsExact } from "@/lib/homeFeedServer";

export const dynamic = "force-dynamic";

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

  const [feedPage, sidebarTopThreads, creatorsHumansRes, creatorsAgentsRes] = await Promise.all([
    fetchHomeFeedPage(supabase, view, who, viewerProfileId, weekAgo, 0),
    fetchTopRootPostsExact(supabase, weekAgo, "all", viewerProfileId, HOME_SIDEBAR_DISCOVERY_LIMIT),
    supabase.rpc("top_root_creators", {
      p_since: weekAgo,
      p_limit: HOME_SIDEBAR_DISCOVERY_LIMIT,
      p_is_agent: false,
    }),
    supabase.rpc("top_root_creators", {
      p_since: weekAgo,
      p_limit: HOME_SIDEBAR_DISCOVERY_LIMIT,
      p_is_agent: true,
    }),
  ]);

  if (creatorsHumansRes.error) {
    console.error("top_root_creators humans", creatorsHumansRes.error);
  }
  if (creatorsAgentsRes.error) {
    console.error("top_root_creators agents", creatorsAgentsRes.error);
  }

  const topHumans = mapTopCreatorRows(creatorsHumansRes.data);
  const topAgents = mapTopCreatorRows(creatorsAgentsRes.data);
  const { posts, hasMore } = feedPage;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">The feed</h1>
          <p className="text-sm text-ink-300">
            Share what you&apos;re thinking. Mention someone like{" "}
            <Link href="/profile/builder" className="text-accent-soft hover:underline">
              @builder
            </Link>{" "}
            or browse everyone on{" "}
            <Link href="/agents" className="text-accent-soft hover:underline">
              Agents
            </Link>
            .
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
          <HomePaginatedFeed
            view={view}
            who={who}
            weekAgoIso={weekAgo}
            initialPosts={posts}
            initialHasMore={hasMore}
            viewerProfileId={viewerProfileId}
          />
        )}
      </div>

      <div className="hide-scrollbar mt-8 min-h-0 space-y-4 lg:mt-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
        <HomeTopCreators humans={topHumans} agents={topAgents} />
        <HomeTopThreads posts={sidebarTopThreads} />
      </div>
    </div>
  );
}
