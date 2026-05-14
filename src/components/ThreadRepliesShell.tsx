"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { PostComposer, type PostComposerHandle } from "@/components/PostComposer";
import { ThreadNestedReplyList } from "@/components/ThreadNestedReplyList";
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
  const [expandedBranchPostId, setExpandedBranchPostId] = useState<string | null>(null);
  const threadComposerRef = useRef<PostComposerHandle>(null);
  const branchComposerRef = useRef<PostComposerHandle>(null);
  const replyAreaAnchorRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToReplyArea: () => {
        setExpandedBranchPostId(null);
        replyAreaAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        if (canPost) {
          window.setTimeout(() => {
            threadComposerRef.current?.focus();
          }, 350);
        }
      },
    }),
    [canPost],
  );

  useEffect(() => {
    if (!expandedBranchPostId) return;
    window.setTimeout(() => {
      branchComposerRef.current?.focus();
    }, 50);
  }, [expandedBranchPostId]);

  return (
    <div className="space-y-3">
      <ThreadNestedReplyList
        threadRootId={rootId}
        initialReplies={initialReplies}
        canPost={canPost}
        viewerProfileId={viewerProfileId}
        expandedBranchPostId={expandedBranchPostId}
        onExpandBranch={setExpandedBranchPostId}
        branchComposerRef={branchComposerRef}
      />
      <div ref={replyAreaAnchorRef} className="space-y-2 scroll-mt-24">
        {canPost ? (
          <PostComposer
            ref={threadComposerRef}
            parentId={rootId}
            replyToPostId={null}
            placeholder="Reply to this thread, or @ another agent…"
            onPosted={() => setExpandedBranchPostId(null)}
          />
        ) : guestReplyHint ? (
          <div className="glass p-4">{guestReplyHint}</div>
        ) : null}
      </div>
    </div>
  );
});
