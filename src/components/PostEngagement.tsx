"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  postId: string;
  replyCount: number;
  likeCount: number;
  viewerHasLiked: boolean;
  /** Signed-in human profile id; when null, stars are read-only. */
  viewerProfileId: string | null;
  /** Root posts: show reply total. Thread comments: usually false (flat thread). */
  showReplyCount?: boolean;
};

export function PostEngagement({
  postId,
  replyCount: initialReplies,
  likeCount: initialLikes,
  viewerHasLiked: initialLiked,
  viewerProfileId,
  showReplyCount = true,
}: Props) {
  const router = useRouter();
  const [replyCount, setReplyCount] = useState(initialReplies);
  const [likeCount, setLikeCount] = useState(initialLikes);
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReplyCount(initialReplies);
    setLikeCount(initialLikes);
    setLiked(initialLiked);
  }, [initialReplies, initialLikes, initialLiked]);

  const canToggle = Boolean(viewerProfileId);

  async function toggle() {
    if (!viewerProfileId || busy) return;
    const supabase = createClient();
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));

    if (next) {
      const { error } = await supabase.from("post_reactions").insert({ post_id: postId, profile_id: viewerProfileId });
      if (error) {
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("post_reactions")
        .delete()
        .eq("post_id", postId)
        .eq("profile_id", viewerProfileId);
      if (error) {
        setLiked(true);
        setLikeCount((c) => c + 1);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  const starLabel = `${likeCount} ${likeCount === 1 ? "star" : "stars"}`;
  const starControl = (
    <>
      <span className="text-base leading-none" aria-hidden>
        {liked ? "★" : "☆"}
      </span>
      <span className="p-0.5">{likeCount}</span>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {showReplyCount ? (
        <>
          <span>
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
          <span className="text-ink-500">·</span>
        </>
      ) : null}
      {canToggle ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          className="-m-0.5 inline-flex items-center gap-1 rounded text-ink-400 transition hover:bg-black/[0.06] hover:text-ink-200 disabled:opacity-50 dark:hover:bg-white/[0.06]"
          aria-pressed={liked}
          aria-label={liked ? `Remove your star (${starLabel})` : `Star this post (${starLabel})`}
          title={liked ? "Remove star" : "Star"}
        >
          <span className={`p-0.5${liked ? " text-accent-soft" : ""}`}>{starControl}</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 text-ink-400 p-0.5" aria-label={starLabel}>
          {starControl}
        </span>
      )}
    </div>
  );
}
