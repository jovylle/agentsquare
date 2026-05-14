"use client";

import { useEffect, useMemo, useState, type Ref, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import { PostComposer, type PostComposerHandle } from "@/components/PostComposer";
import { buildThreadReplyTree, type ReplyTreeNode } from "@/lib/threadReplyTree";
import type { PostWithAuthor } from "@/lib/supabase/types";

type Props = {
  threadRootId: string;
  initialReplies: PostWithAuthor[];
  canPost: boolean;
  viewerProfileId?: string | null;
  /** When set, this branch's composer is expanded (only one at a time). */
  expandedBranchPostId: string | null;
  onExpandBranch: (postId: string | null) => void;
  branchComposerRef: RefObject<PostComposerHandle | null>;
};

function NestedBranch({
  node,
  depth,
  threadRootId,
  canPost,
  viewerProfileId,
  expandedBranchPostId,
  onExpandBranch,
  branchComposerRef,
}: {
  node: ReplyTreeNode;
  depth: number;
  threadRootId: string;
  canPost: boolean;
  viewerProfileId: string | null;
  expandedBranchPostId: string | null;
  onExpandBranch: (postId: string | null) => void;
  branchComposerRef: RefObject<PostComposerHandle | null>;
}) {
  const isTop = depth === 0;
  const expanded = isTop && expandedBranchPostId === node.post.id;

  return (
    <div className={depth > 0 ? "mt-2 border-l-2 border-black/[0.08] pl-3 dark:border-white/10" : ""}>
      <PostCard
        post={node.post}
        showReplyLink={false}
        threadReply={false}
        viewerProfileId={viewerProfileId}
        showReplyCount={false}
        hideReplyToPreview={depth > 0}
      />
      {node.children.length > 0 ? (
        <div className="space-y-0">
          {node.children.map((child) => (
            <NestedBranch
              key={child.post.id}
              node={child}
              depth={depth + 1}
              threadRootId={threadRootId}
              canPost={canPost}
              viewerProfileId={viewerProfileId}
              expandedBranchPostId={expandedBranchPostId}
              onExpandBranch={onExpandBranch}
              branchComposerRef={branchComposerRef}
            />
          ))}
        </div>
      ) : null}
      {isTop && canPost ? (
        <div className="mt-3 space-y-2">
          {expanded ? (
            <>
              <div className="flex items-center justify-between gap-2 text-xs text-ink-300">
                <span>
                  Replying to{" "}
                  <span className="font-medium text-ink-200">@{node.post.author.handle}</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-accent-soft hover:underline"
                  onClick={() => onExpandBranch(null)}
                >
                  Cancel
                </button>
              </div>
              <PostComposer
                ref={branchComposerRef as Ref<PostComposerHandle>}
                parentId={threadRootId}
                replyToPostId={node.post.id}
                placeholder={`Reply to @${node.post.author.handle}…`}
                onPosted={() => onExpandBranch(null)}
              />
            </>
          ) : (
            <button
              type="button"
              className="text-xs text-accent-soft hover:underline"
              onClick={() => onExpandBranch(node.post.id)}
            >
              Reply
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadNestedReplyList({
  threadRootId,
  initialReplies,
  canPost,
  viewerProfileId = null,
  expandedBranchPostId,
  onExpandBranch,
  branchComposerRef,
}: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>(initialReplies);

  useEffect(() => {
    setPosts(initialReplies);
  }, [initialReplies]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`posts-thread-nested-${threadRootId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "posts",
          filter: `parent_id=eq.${threadRootId}`,
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
          filter: `parent_id=eq.${threadRootId}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, threadRootId]);

  const roots = useMemo(() => buildThreadReplyTree(posts, threadRootId), [posts, threadRootId]);

  if (roots.length === 0) {
    return (
      <p className="glass p-6 text-center text-sm text-ink-400">
        Nothing here yet. Make the first move.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {roots.map((node) => (
        <NestedBranch
          key={node.post.id}
          node={node}
          depth={0}
          threadRootId={threadRootId}
          canPost={canPost}
          viewerProfileId={viewerProfileId}
          expandedBranchPostId={expandedBranchPostId}
          onExpandBranch={onExpandBranch}
          branchComposerRef={branchComposerRef}
        />
      ))}
    </div>
  );
}
