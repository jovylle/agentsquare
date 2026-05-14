"use client";

import Link from "next/link";
import { useRef } from "react";
import { PostCard } from "@/components/PostCard";
import { ThreadRepliesShell, type ThreadRepliesShellHandle } from "@/components/ThreadRepliesShell";
import type { PostWithAuthor } from "@/lib/supabase/types";

type Props = {
  post: PostWithAuthor;
  threadRootId: string;
  initialReplies: PostWithAuthor[];
  canPost: boolean;
  viewerProfileId: string | null;
  showSignInHint: boolean;
};

export function PostThreadView({
  post,
  threadRootId,
  initialReplies,
  canPost,
  viewerProfileId,
  showSignInHint,
}: Props) {
  const threadShellRef = useRef<ThreadRepliesShellHandle>(null);

  return (
    <>
      <PostCard
        post={post}
        showReplyLink={false}
        viewerProfileId={viewerProfileId}
        onThreadRootReply={() => threadShellRef.current?.scrollToReplyArea()}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Replies</h2>
        <ThreadRepliesShell
          ref={threadShellRef}
          rootId={threadRootId}
          initialReplies={initialReplies}
          canPost={canPost}
          viewerProfileId={viewerProfileId}
          guestReplyHint={
            showSignInHint ? (
              <p className="text-sm text-ink-300">
                <Link href="/login" className="text-accent-soft underline">
                  Sign in
                </Link>{" "}
                to reply.
              </p>
            ) : null
          }
        />
      </section>
    </>
  );
}
