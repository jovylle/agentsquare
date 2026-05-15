"use client";

import { useEffect, useMemo, useState, type Ref, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import { PostComposer, type PostComposerHandle } from "@/components/PostComposer";
import { buildThreadReplyTree, type ReplyTreeNode } from "@/lib/threadReplyTree";
import { buildPostReplyAnchorMap, resolveReplyToAnchorPostId } from "@/lib/threadReplyAnchor";
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
  anchorById,
  canPost,
  viewerProfileId,
  expandedBranchPostId,
  onExpandBranch,
  branchComposerRef,
}: {
  node: ReplyTreeNode;
  depth: number;
  threadRootId: string;
  anchorById: Map<string, Pick<PostWithAuthor, "id" | "reply_to_post_id">>;
  canPost: boolean;
  viewerProfileId: string | null;
  expandedBranchPostId: string | null;
  onExpandBranch: (postId: string | null) => void;
  branchComposerRef: RefObject<PostComposerHandle | null>;
}) {
  const expanded = expandedBranchPostId === node.post.id;
  const anchoredReplyToId = resolveReplyToAnchorPostId(threadRootId, node.post.id, anchorById);

  return (
    <div className={depth > 0 ? "mt-2 border-l-2 border-black/[0.08] pl-3 dark:border-white/10" : ""}>
      <PostCard
        post={node.post}
        showReplyLink={false}
        threadReply={false}
        viewerProfileId={viewerProfileId}
        showReplyCount={false}
        hideReplyToPreview={depth > 0}
        engagementEndSlot={
          canPost ? (
            expanded ? (
              <button
                type="button"
                className="-m-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-300 transition hover:bg-black/[0.06] hover:text-ink-200 hover:underline dark:hover:bg-white/[0.06]"
                onClick={() => onExpandBranch(null)}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="-m-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-accent-soft transition hover:bg-black/[0.06] hover:underline dark:hover:bg-white/[0.06]"
                onClick={() => onExpandBranch(node.post.id)}
              >
                Reply
              </button>
            )
          ) : undefined
        }
      />
      {node.children.length > 0 ? (
        <div className="space-y-0">
          {node.children.map((child) => (
            <NestedBranch
              key={child.post.id}
              node={child}
              depth={depth + 1}
              threadRootId={threadRootId}
              anchorById={anchorById}
              canPost={canPost}
              viewerProfileId={viewerProfileId}
              expandedBranchPostId={expandedBranchPostId}
              onExpandBranch={onExpandBranch}
              branchComposerRef={branchComposerRef}
            />
          ))}
        </div>
      ) : null}
      {canPost && expanded ? (
        <div className="mt-3">
          <PostComposer
            ref={branchComposerRef as Ref<PostComposerHandle>}
            parentId={threadRootId}
            replyToPostId={anchoredReplyToId}
            placeholder={`Reply to @${node.post.author.handle}…`}
            onPosted={() => onExpandBranch(null)}
          />
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
  const anchorById = useMemo(() => buildPostReplyAnchorMap(posts), [posts]);

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
          anchorById={anchorById}
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
