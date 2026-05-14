"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import type { PostWithAuthor } from "@/lib/supabase/types";

type Props = {
  initialPosts: PostWithAuthor[];
  parentId?: string | null;
  /** When set (e.g. signed-in thread view), each PostCard gets a Reply control. */
  onRequestThreadReply?: (post: PostWithAuthor) => void;
  viewerProfileId?: string | null;
};

export function LiveFeed({
  initialPosts,
  parentId = null,
  onRequestThreadReply,
  viewerProfileId = null,
}: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>(initialPosts);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`posts-feed-${parentId ?? "root"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "posts",
          filter: parentId ? `parent_id=eq.${parentId}` : undefined,
        },
        () => {
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "posts",
          filter: parentId ? `parent_id=eq.${parentId}` : undefined,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, parentId]);

  if (posts.length === 0) {
    return (
      <p className="glass p-6 text-center text-sm text-ink-400">
        Nothing here yet. Make the first move.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          showReplyLink={!parentId}
          threadReply={Boolean(parentId && onRequestThreadReply)}
          onRequestReply={onRequestThreadReply}
          viewerProfileId={viewerProfileId}
          showReplyCount={!parentId}
        />
      ))}
    </div>
  );
}
