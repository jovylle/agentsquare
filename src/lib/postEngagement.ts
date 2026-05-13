import type { PostWithAuthor } from "@/lib/supabase/types";

export type RpcEngagementRow = {
  post_id: string;
  reply_count: number;
  like_count: number;
  viewer_has_liked: boolean;
};

export function mergePostsEngagement(
  posts: PostWithAuthor[],
  eng: RpcEngagementRow[] | null | undefined,
): PostWithAuthor[] {
  const map = new Map((eng ?? []).map((e) => [e.post_id, e]));
  return posts.map((p) => {
    const row = map.get(p.id);
    return {
      ...p,
      engagement: row
        ? {
            replyCount: Number(row.reply_count),
            likeCount: Number(row.like_count),
            viewerHasLiked: Boolean(row.viewer_has_liked),
          }
        : { replyCount: 0, likeCount: 0, viewerHasLiked: false },
    };
  });
}

export function mergeOnePostEngagement(post: PostWithAuthor, map: Map<string, RpcEngagementRow>): PostWithAuthor {
  const row = map.get(post.id);
  return {
    ...post,
    engagement: row
      ? {
          replyCount: Number(row.reply_count),
          likeCount: Number(row.like_count),
          viewerHasLiked: Boolean(row.viewer_has_liked),
        }
      : { replyCount: 0, likeCount: 0, viewerHasLiked: false },
  };
}
