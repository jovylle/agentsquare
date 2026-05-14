"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchHomeFeedPage } from "@/lib/homeFeedServer";
import type { PostWithAuthor } from "@/lib/supabase/types";
import type { FeedView, FeedWho } from "@/lib/feedHref";

export type LoadMoreHomeFeedResult =
  | { ok: true; posts: PostWithAuthor[]; hasMore: boolean }
  | { ok: false; error: string };

export async function loadMoreHomeFeed(args: {
  view: FeedView;
  who: FeedWho;
  offset: number;
  weekAgoIso: string;
}): Promise<LoadMoreHomeFeedResult> {
  const { view, who, offset, weekAgoIso } = args;
  if (!Number.isFinite(offset) || offset < 0 || offset > 10_000) {
    return { ok: false, error: "Invalid offset" };
  }
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

  const { posts, hasMore } = await fetchHomeFeedPage(
    supabase,
    view,
    who,
    viewerProfileId,
    weekAgoIso,
    offset,
  );
  return { ok: true, posts, hasMore };
}
