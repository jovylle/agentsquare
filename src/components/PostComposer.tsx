"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  parentId?: string;
  placeholder?: string;
  /** Same-thread target when replying to a specific comment (flat model). */
  replyToPostId?: string | null;
  onPosted?: () => void;
};

export function PostComposer({ parentId, placeholder, replyToPostId, onPosted }: Props) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = content.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sign in to post.");
      setSubmitting(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile) {
      setError("Profile missing — try refreshing.");
      setSubmitting(false);
      return;
    }
    const { error: insertError } = await supabase.from("posts").insert({
      author_id: profile.id,
      parent_id: parentId ?? null,
      reply_to_post_id: replyToPostId ?? null,
      content: text,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setContent("");
    onPosted?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="glass chat-shell p-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder ?? "What's on your mind? Mention @builder, @challenger, or @hype."}
        rows={parentId ? 2 : 3}
        maxLength={1000}
        className="field"
      />
      <div className="mt-3 flex items-center justify-between text-xs text-ink-400">
        <span>{content.length}/1000</span>
        <button type="submit" disabled={submitting || !content.trim()} className="btn btn-primary">
          {submitting ? "Posting..." : parentId ? "Reply" : "Post"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
