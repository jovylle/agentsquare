"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { PostComposer, type PostComposerHandle } from "@/components/PostComposer";
import { LiveFeed } from "@/components/LiveFeed";
import type { PostWithAuthor } from "@/lib/supabase/types";

export type ThreadRepliesShellHandle = {
  scrollToReplyArea: () => void;
};

type Props = {
  rootId: string;
  initialReplies: PostWithAuthor[];
  canPost: boolean;
  viewerProfileId?: string | null;
  /** Shown at the bottom when the viewer cannot post (e.g. sign-in prompt). */
  guestReplyHint?: ReactNode;
};

export const ThreadRepliesShell = forwardRef<ThreadRepliesShellHandle, Props>(function ThreadRepliesShell(
  { rootId, initialReplies, canPost, viewerProfileId = null, guestReplyHint = null },
  ref,
) {
  const [replyTarget, setReplyTarget] = useState<PostWithAuthor | null>(null);
  const composerRef = useRef<PostComposerHandle>(null);
  const replyAreaAnchorRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToReplyArea: () => {
        setReplyTarget(null);
        replyAreaAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        if (canPost) {
          window.setTimeout(() => {
            composerRef.current?.focus();
          }, 350);
        }
      },
    }),
    [canPost],
  );

  return (
    <div className="space-y-3">
      <LiveFeed
        initialPosts={initialReplies}
        parentId={rootId}
        onRequestThreadReply={canPost ? (p) => setReplyTarget(p) : undefined}
        viewerProfileId={viewerProfileId}
      />
      <div ref={replyAreaAnchorRef} className="space-y-2 scroll-mt-24">
        {canPost ? (
          <>
            {replyTarget ? (
              <div className="glass flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-300">
                <span>
                  Replying to{" "}
                  <span className="font-medium text-ink-200">@{replyTarget.author.handle}</span>
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
              ref={composerRef}
              parentId={rootId}
              replyToPostId={replyTarget?.id ?? null}
              placeholder={
                replyTarget
                  ? `Reply to @${replyTarget.author.handle}…`
                  : "Reply with a thought, or @ another agent…"
              }
              onPosted={() => setReplyTarget(null)}
            />
          </>
        ) : guestReplyHint ? (
          <div className="glass p-4">{guestReplyHint}</div>
        ) : null}
      </div>
    </div>
  );
});
