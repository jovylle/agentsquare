"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  parentId?: string;
  placeholder?: string;
  /** Same-thread target when replying to a specific comment (flat model). */
  replyToPostId?: string | null;
  onPosted?: () => void;
};

type AgentMention = { handle: string; display_name: string };

function mentionContextAt(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const afterAt = before.slice(at + 1);
  if (/[\s\n]/.test(afterAt)) return null;
  if (afterAt.length > 0 && !/^[a-z0-9_]*$/i.test(afterAt)) return null;
  return { start: at, query: afterAt.toLowerCase() };
}

export function PostComposer({ parentId, placeholder, replyToPostId, onPosted }: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentMention[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  /** After Escape, hide the menu until the @-token text changes. */
  const mentionHiddenToken = useRef<string | null>(null);

  const mentionCtx = useMemo(() => mentionContextAt(content, cursor), [content, cursor]);

  const currentMentionToken = mentionCtx ? content.slice(mentionCtx.start, cursor) : null;

  useEffect(() => {
    if (mentionHiddenToken.current === null) return;
    if (!mentionCtx) {
      mentionHiddenToken.current = null;
      return;
    }
    if (currentMentionToken !== mentionHiddenToken.current) mentionHiddenToken.current = null;
  }, [mentionCtx, currentMentionToken]);

  const matches = useMemo(() => {
    if (!mentionCtx) return [];
    const q = mentionCtx.query;
    const list = agents.filter((a) => a.handle.toLowerCase().startsWith(q));
    return list.slice(0, 8);
  }, [agents, mentionCtx]);

  const menuOpen = Boolean(
    mentionCtx &&
      agents.length > 0 &&
      matches.length > 0 &&
      currentMentionToken !== mentionHiddenToken.current,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("handle, display_name, agents(is_active)")
        .eq("is_agent", true)
        .order("display_name");
      if (cancelled || fetchError) return;
      const rows = (data ?? []) as {
        handle: string;
        display_name: string;
        agents: { is_active: boolean }[] | null;
      }[];
      setAgents(
        rows
          .filter((r) => (r.agents?.[0]?.is_active ?? true) !== false)
          .map((r) => ({ handle: r.handle, display_name: r.display_name })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setHighlightIdx(0);
  }, [mentionCtx?.start, mentionCtx?.query]);

  useEffect(() => {
    if (highlightIdx >= matches.length) setHighlightIdx(Math.max(0, matches.length - 1));
  }, [highlightIdx, matches.length]);

  const syncCursorFromEl = useCallback((el: HTMLTextAreaElement) => {
    setCursor(el.selectionStart);
  }, []);

  const applyMention = useCallback(
    (handle: string) => {
      if (!mentionCtx || !textareaRef.current) return;
      const el = textareaRef.current;
      const { start } = mentionCtx;
      const end = cursor;
      const before = content.slice(0, start);
      const after = content.slice(end);
      const insertion = `@${handle} `;
      const next = before + insertion + after;
      const nextCursor = before.length + insertion.length;
      mentionHiddenToken.current = null;
      setContent(next);
      setCursor(nextCursor);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [content, cursor, mentionCtx],
  );

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
    setCursor(0);
    onPosted?.();
    router.refresh();
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!menuOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyMention(matches[highlightIdx]!.handle);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (mentionCtx) mentionHiddenToken.current = content.slice(mentionCtx.start, cursor);
    }
  }

  return (
    <form onSubmit={submit} className="glass p-4">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            syncCursorFromEl(e.target);
          }}
          onSelect={(e) => syncCursorFromEl(e.currentTarget)}
          onClick={(e) => syncCursorFromEl(e.currentTarget)}
          onKeyUp={(e) => syncCursorFromEl(e.currentTarget)}
          onKeyDown={onTextareaKeyDown}
          placeholder={
            placeholder ?? "What's on your mind? Mention @builder, @challenger, or @hype."
          }
          rows={parentId ? 2 : 3}
          maxLength={1000}
          className="field"
        />
        {menuOpen ? (
          <ul
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto border-2 border-dashed border-white/10 bg-ink-900/95 py-1 text-sm shadow-lg backdrop-blur"
            role="listbox"
          >
            {matches.map((a, i) => (
              <li key={a.handle}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlightIdx}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/5 ${
                    i === highlightIdx ? "bg-accent/15 text-accent-soft" : "text-ink-200"
                  }`}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    applyMention(a.handle);
                  }}
                  onMouseEnter={() => setHighlightIdx(i)}
                >
                  <span className="font-medium">@{a.handle}</span>
                  <span className="truncate text-xs text-ink-400">{a.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
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
