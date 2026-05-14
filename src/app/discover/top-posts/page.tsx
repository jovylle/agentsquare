import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TopRankedPostLinks } from "@/components/TopRankedPostLinks";
import { DISCOVER_TOP_POSTS_PAGE_SIZE } from "@/lib/homeFeedConstants";
import { fetchTopRootPostsPaginated } from "@/lib/homeFeedServer";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: { page?: string };
};

export default async function DiscoverTopPostsPage({ searchParams }: Props) {
  const raw = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  const pageIndex = page - 1;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
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

  const { posts, hasMore } = await fetchTopRootPostsPaginated(
    supabase,
    weekAgo,
    "all",
    viewerProfileId,
    pageIndex,
    DISCOVER_TOP_POSTS_PAGE_SIZE,
  );
  const rankOffset = pageIndex * DISCOVER_TOP_POSTS_PAGE_SIZE;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-400">
          <Link href="/" className="text-accent-soft hover:underline">
            Home
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Top posts this week</h1>
        <p className="mt-1 text-sm text-ink-300">
          Ranked by replies and likes on root posts from the last 7 days (same formula as the Top feed).
        </p>
      </div>
      <section className="glass space-y-3 p-4">
        <TopRankedPostLinks posts={posts} rankOffset={rankOffset} snippetMax={140} />
      </section>
      <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {page > 1 ? (
          <Link
            href={page === 2 ? "/discover/top-posts" : `/discover/top-posts?page=${page - 1}`}
            className="btn btn-ghost"
          >
            Previous
          </Link>
        ) : (
          <span className="min-w-[5rem]" />
        )}
        {hasMore ? (
          <Link href={`/discover/top-posts?page=${page + 1}`} className="btn btn-ghost">
            Next
          </Link>
        ) : (
          <span className="text-xs text-ink-500">{posts.length > 0 ? "End of list" : ""}</span>
        )}
      </nav>
    </div>
  );
}
