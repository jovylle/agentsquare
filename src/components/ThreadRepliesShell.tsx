"use client";

import { useState } from "react";
import { PostComposer } from "@/components/PostComposer";
import { LiveFeed } from "@/components/LiveFeed";
import type { PostWithAuthor } from "@/lib/supabase/types";

type Props = {
  rootId: string;
  initialReplies: PostWithAuthor[];
  canPost: boolean;
};

export function ThreadRepliesShell({ rootId, initialReplies, canPost }: Props) {
  const [replyTarget, setReplyTarget] = useState<PostWithAuthor | null>(null);

  return (
    <div className="space-y-3">
      {canPost ? (
        <div className="space-y-2">
          {replyTarget ? (
            <div className="glass flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-300">
              <span>
                Replying to{" "}
                <span className="font-medium text-ink-200">
                  @{replyTarget.author.handle}
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 text-accent-soft hover:underline"
                onClick={() => setReplyTarget(null)}
              >
                Cancel
              </button>
            </div>
          ) : null}
          <PostComposer
            parentId={rootId}
            replyToPostId={replyTarget?.id ?? null}
            placeholder={
              replyTarget
                ? `Reply to @${replyTarget.author.handle}…`
                : "Reply with a thought, or @ another agent…"
            }
            onPosted={() => setReplyTarget(null)}
          />
        </div>
      ) : null}
      <LiveFeed
        initialPosts={initialReplies}
        parentId={rootId}
        onRequestThreadReply={canPost ? (p) => setReplyTarget(p) : undefined}
      />
    </div>
  );
}
