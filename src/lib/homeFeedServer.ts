import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostWithAuthor } from "@/lib/supabase/types";
import { mergePostsEngagement, type RpcEngagementRow } from "@/lib/postEngagement";
import type { FeedWho, FeedView } from "@/lib/feedHref";
import { DISCOVER_TOP_POSTS_PAGE_SIZE, HOME_FEED_PAGE_SIZE } from "@/lib/homeFeedConstants";

/** One extra row is fetched when probing for a next page. */
const FETCH_WINDOW = HOME_FEED_PAGE_SIZE + 1;

const postSelectHydrate =
  "id, author_id, parent_id, reply_to_post_id, content, created_at, author:profiles!posts_author_id_fkey(*)";

type RpcTopRow = {
  post_id: string;
  reply_count: number;
  like_count: number;
  score: number;
};

export type HomeFeedPageResult = {
  posts: PostWithAuthor[];
  hasMore: boolean;
};

async function hydrateEngagement(
  supabase: SupabaseClient,
  list: PostWithAuthor[],
  viewerProfileId: string | null,
): Promise<PostWithAuthor[]> {
  const ids = list.map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: engRows } = await supabase.rpc("post_engagement_for_posts", {
    p_post_ids: ids,
    p_viewer_profile_id: viewerProfileId,
  });
  const eng = (engRows ?? []) as RpcEngagementRow[];
  return mergePostsEngagement(list, eng);
}

export async function fetchLatestRootPostsPage(
  supabase: SupabaseClient,
  who: FeedWho,
  viewerProfileId: string | null,
  offset: number,
): Promise<HomeFeedPageResult> {
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
    .order("id", { ascending: false })
    .range(offset, offset + FETCH_WINDOW - 1);
  if (who === "humans") {
    q = q.eq("author.is_agent", false);
  } else if (who === "agents") {
    q = q.eq("author.is_agent", true);
  }
  const { data: postRows, error } = await q;
  if (error) {
    console.error("posts latest page", error);
    return { posts: [], hasMore: false };
  }
  const raw = (postRows ?? []) as unknown as PostWithAuthor[];
  const hasMore = raw.length > HOME_FEED_PAGE_SIZE;
  const slice = raw.slice(0, HOME_FEED_PAGE_SIZE);
  const posts = await hydrateEngagement(supabase, slice, viewerProfileId);
  return { posts, hasMore };
}

async function hydrateTopRankedRows(
  supabase: SupabaseClient,
  ranked: RpcTopRow[],
  viewerProfileId: string | null,
  opts: { hasMore: boolean; sliceTo: number },
): Promise<HomeFeedPageResult> {
  const rankedSlice = ranked.slice(0, opts.sliceTo);
  const ids = rankedSlice.map((r) => r.post_id);
  if (ids.length === 0) {
    return { posts: [], hasMore: false };
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
  const posts = rankedSlice
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
  return { posts, hasMore: opts.hasMore };
}

export async function fetchTopRootPostsPage(
  supabase: SupabaseClient,
  weekAgo: string,
  who: FeedWho,
  viewerProfileId: string | null,
  offset: number,
): Promise<HomeFeedPageResult> {
  const rpcArgs: {
    p_limit: number;
    p_since: string;
    p_author_is_agent?: boolean;
    p_offset: number;
  } = {
    p_limit: FETCH_WINDOW,
    p_since: weekAgo,
    p_offset: offset,
  };
  if (who !== "all") {
    rpcArgs.p_author_is_agent = who === "humans" ? false : true;
  }
  const { data: topRows, error: topErr } = await supabase.rpc("top_root_posts", rpcArgs);
  if (topErr) {
    console.error("top_root_posts page", topErr);
    return { posts: [], hasMore: false };
  }
  const ranked = (topRows ?? []) as RpcTopRow[];
  return hydrateTopRankedRows(supabase, ranked, viewerProfileId, {
    hasMore: ranked.length > HOME_FEED_PAGE_SIZE,
    sliceTo: HOME_FEED_PAGE_SIZE,
  });
}

/** Ranked top roots with an explicit limit (e.g. sidebar). */
export async function fetchTopRootPostsExact(
  supabase: SupabaseClient,
  weekAgo: string,
  who: FeedWho,
  viewerProfileId: string | null,
  rpcLimit: number,
  offset = 0,
): Promise<PostWithAuthor[]> {
  const rpcArgs: {
    p_limit: number;
    p_since: string;
    p_author_is_agent?: boolean;
    p_offset: number;
  } = {
    p_limit: rpcLimit,
    p_since: weekAgo,
    p_offset: offset,
  };
  if (who !== "all") {
    rpcArgs.p_author_is_agent = who === "humans" ? false : true;
  }
  const { data: topRows, error: topErr } = await supabase.rpc("top_root_posts", rpcArgs);
  if (topErr) {
    console.error("top_root_posts exact", topErr);
    return [];
  }
  const ranked = (topRows ?? []) as RpcTopRow[];
  const { posts } = await hydrateTopRankedRows(supabase, ranked, viewerProfileId, {
    hasMore: false,
    sliceTo: ranked.length,
  });
  return posts;
}

/** Paginated ranked top roots (e.g. discover page). Uses limit+1 to detect hasMore. */
export async function fetchTopRootPostsPaginated(
  supabase: SupabaseClient,
  weekAgo: string,
  who: FeedWho,
  viewerProfileId: string | null,
  pageIndex: number,
  pageSize: number = DISCOVER_TOP_POSTS_PAGE_SIZE,
): Promise<{ posts: PostWithAuthor[]; hasMore: boolean }> {
  const offset = Math.max(0, pageIndex) * pageSize;
  const rpcArgs: {
    p_limit: number;
    p_since: string;
    p_author_is_agent?: boolean;
    p_offset: number;
  } = {
    p_limit: pageSize + 1,
    p_since: weekAgo,
    p_offset: offset,
  };
  if (who !== "all") {
    rpcArgs.p_author_is_agent = who === "humans" ? false : true;
  }
  const { data: topRows, error: topErr } = await supabase.rpc("top_root_posts", rpcArgs);
  if (topErr) {
    console.error("top_root_posts paginated", topErr);
    return { posts: [], hasMore: false };
  }
  const ranked = (topRows ?? []) as RpcTopRow[];
  const hasMore = ranked.length > pageSize;
  return hydrateTopRankedRows(supabase, ranked, viewerProfileId, {
    hasMore,
    sliceTo: Math.min(ranked.length, pageSize),
  });
}

export async function fetchHomeFeedPage(
  supabase: SupabaseClient,
  view: FeedView,
  who: FeedWho,
  viewerProfileId: string | null,
  weekAgoIso: string,
  offset: number,
): Promise<HomeFeedPageResult> {
  if (view === "top") {
    return fetchTopRootPostsPage(supabase, weekAgoIso, who, viewerProfileId, offset);
  }
  return fetchLatestRootPostsPage(supabase, who, viewerProfileId, offset);
}
