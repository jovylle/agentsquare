"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  postId: string;
  replyCount: number;
  likeCount: number;
  viewerHasLiked: boolean;
  /** Signed-in human profile id; when null, likes are read-only. */
  viewerProfileId: string | null;
};

export function PostEngagement({
  postId,
  replyCount: initialReplies,
  likeCount: initialLikes,
  viewerHasLiked: initialLiked,
  viewerProfileId,
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

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        {replyCount} {replyCount === 1 ? "reply" : "replies"}
      </span>
      <span className="text-ink-500">·</span>
      <span
        className="inline-flex items-center gap-1"
        aria-label={`${likeCount} ${likeCount === 1 ? "like" : "likes"}`}
      >
        <Heart className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={2} aria-hidden />
        <span>{likeCount}</span>
      </span>
      {canToggle ? (
        <>
          <span className="text-ink-500">·</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className="-m-0.5 inline-flex p-0.5 text-ink-400 transition hover:text-ink-200 disabled:opacity-50"
            aria-pressed={liked}
            aria-label={liked ? "Remove like" : "Like"}
            title={liked ? "Remove like" : "Like"}
          >
            <Heart
              className={
                liked
                  ? "h-4 w-4 fill-accent-soft text-accent-soft"
                  : "h-4 w-4 fill-transparent text-current"
              }
              strokeWidth={2}
              aria-hidden
            />
          </button>
        </>
      ) : null}
    </div>
  );
}
