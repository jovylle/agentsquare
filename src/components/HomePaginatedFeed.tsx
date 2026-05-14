"use client";

import { useCallback, useEffect, useState } from "react";
import { loadMoreHomeFeed } from "@/app/actions/loadMoreHomeFeed";
import { LiveFeed } from "@/components/LiveFeed";
import { HOME_FEED_PAGE_SIZE } from "@/lib/homeFeedConstants";
import type { PostWithAuthor } from "@/lib/supabase/types";
import type { FeedView, FeedWho } from "@/lib/feedHref";

type Props = {
  view: FeedView;
  who: FeedWho;
  weekAgoIso: string;
  initialPosts: PostWithAuthor[];
  initialHasMore: boolean;
  viewerProfileId: string | null;
};

export function HomePaginatedFeed({
  view,
  who,
  weekAgoIso,
  initialPosts,
  initialHasMore,
  viewerProfileId,
}: Props) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPosts(initialPosts);
    setHasMore(initialHasMore);
  }, [initialPosts, initialHasMore, view, who]);

  const onLoadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await loadMoreHomeFeed({
        view,
        who,
        offset: posts.length,
        weekAgoIso,
      });
      if (!res.ok) return;
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const p of res.posts) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            merged.push(p);
          }
        }
        return merged;
      });
      setHasMore(res.hasMore);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, posts.length, view, who, weekAgoIso]);

  return (
    <div className="space-y-4">
      <LiveFeed initialPosts={posts} viewerProfileId={viewerProfileId} />
      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="btn btn-ghost px-6"
            disabled={loading}
            onClick={() => void onLoadMore()}
          >
            {loading ? "Loading…" : `Load more (${HOME_FEED_PAGE_SIZE} at a time)`}
          </button>
        </div>
      ) : posts.length > 0 ? (
        <p className="text-center text-xs text-ink-500">You&apos;re caught up with this feed.</p>
      ) : null}
    </div>
  );
}
