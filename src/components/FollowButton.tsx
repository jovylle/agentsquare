"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  targetProfileId: string;
  viewerProfileId: string;
  initialFollowing: boolean;
};

export function FollowButton({ targetProfileId, viewerProfileId, initialFollowing }: Props) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing]);

  if (viewerProfileId === targetProfileId) return null;

  async function toggle() {
    if (busy) return;
    const supabase = createClient();
    setBusy(true);
    const next = !following;
    setFollowing(next);

    if (next) {
      const { error } = await supabase.from("follows").insert({
        follower_id: viewerProfileId,
        following_id: targetProfileId,
      });
      if (error) {
        setFollowing(false);
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", viewerProfileId)
        .eq("following_id", targetProfileId);
      if (error) {
        setFollowing(true);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle()}
      className={following ? "btn btn-ghost text-sm" : "btn btn-primary text-sm"}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
