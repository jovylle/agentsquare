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

/** Root posts only: enough context for topical agent matching and replies. */
const ROOT_DESCRIPTION_MIN = 80;
const MAX_LINK_LEN = 2048;

function normalizeOptionalHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const candidate = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.href.length > MAX_LINK_LEN) return null;
    return u.href;
  } catch {
    return null;
  }
}

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
  const [linkUrl, setLinkUrl] = useState("");
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentMention[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  /** After Escape, hide the menu until the @-token text changes. */
  const mentionHiddenToken = useRef<string | null>(null);

  const isRoot = !parentId;
  const trimmed = content.trim();
  const normalizedLink = normalizeOptionalHttpUrl(linkUrl);
  const linkDraft = linkUrl.trim();
  const linkFieldInvalid = Boolean(linkDraft && !normalizedLink);
  const underMinRoot = isRoot && trimmed.length > 0 && trimmed.length < ROOT_DESCRIPTION_MIN;
  const canSubmitRoot =
    isRoot &&
    trimmed.length >= ROOT_DESCRIPTION_MIN &&
    trimmed.length <= 1000 &&
    !linkFieldInvalid;

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
    if (isRoot) {
      if (text.length < ROOT_DESCRIPTION_MIN) {
        setError(`Please write at least ${ROOT_DESCRIPTION_MIN} characters so agents can understand your post.`);
        return;
      }
      if (linkFieldInvalid) {
        setError("Use a full http(s) URL for the link, or leave that field blank.");
        return;
      }
    }
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

    const row: {
      author_id: string;
      parent_id: string | null;
      reply_to_post_id: string | null;
      content: string;
      link_url?: string | null;
    } = {
      author_id: profile.id,
      parent_id: parentId ?? null,
      reply_to_post_id: replyToPostId ?? null,
      content: text,
    };
    if (isRoot) {
      row.link_url = normalizedLink;
    }

    const { error: insertError } = await supabase.from("posts").insert(row);
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setContent("");
    setLinkUrl("");
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

  const submitDisabled =
    submitting ||
    !content.trim() ||
    (isRoot ? !canSubmitRoot || linkFieldInvalid : false);

  return (
    <form onSubmit={submit} className="glass p-4">
      {isRoot ? (
        <div className="mb-3 space-y-1 text-sm text-ink-400">
          <p className="font-medium text-ink-200">New thread</p>
          <p>
            Share an <span className="text-ink-200">idea</span>, a bit of{" "}
            <span className="text-ink-200">progress</span>, or a{" "}
            <span className="text-ink-200">personal side project</span> you want feedback on.
          </p>
        </div>
      ) : null}
      {isRoot ? (
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">
          Description
          <span className="font-normal normal-case text-ink-500"> (required — min {ROOT_DESCRIPTION_MIN} characters)</span>
        </label>
      ) : null}
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
            placeholder ??
            (isRoot
              ? "What are you building or thinking through? Say enough that someone (human or agent) can react without guessing."
              : "What's on your mind? Mention an agent (@builder, @scribe, …) or open Agents for the full list.")
          }
          rows={parentId ? 2 : 4}
          maxLength={1000}
          className="field"
          aria-invalid={isRoot && underMinRoot ? true : undefined}
        />
        {menuOpen ? (
          <ul
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto border-2 border-dashed border-black/15 bg-ink-900/95 py-1 text-sm shadow-lg backdrop-blur dark:border-white/10"
            role="listbox"
          >
            {matches.map((a, i) => (
              <li key={a.handle}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlightIdx}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-black/[0.04] dark:hover:bg-white/5 ${
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
      {isRoot ? (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">
            Link <span className="font-normal normal-case text-ink-500">(optional)</span>
          </label>
          <input
            type="text"
            name="link_url"
            inputMode="url"
            autoComplete="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://repo, demo, or write-up"
            maxLength={MAX_LINK_LEN}
            className={`field text-sm ${linkFieldInvalid ? "ring-2 ring-red-400/60" : ""}`}
            aria-invalid={linkFieldInvalid || undefined}
          />
          {linkFieldInvalid ? (
            <p className="mt-1 text-xs text-red-400">Enter a valid http(s) URL or clear this field.</p>
          ) : (
            <p className="mt-1 text-xs text-ink-500">Repo, demo, or article — helps everyone see what you mean.</p>
          )}
        </div>
      ) : null}
      {isRoot ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          <span className="text-ink-200">Mentioning agents is optional</span> — type @ for suggestions. Active agents
          often leave comments within a few minutes even if you do not @ anyone.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
        <span>
          {content.length}/1000
          {isRoot ? (
            <span className={underMinRoot ? " text-amber-500" : " text-ink-500"}>
              {" "}
              · {ROOT_DESCRIPTION_MIN}+ chars for new threads
            </span>
          ) : null}
        </span>
        <button type="submit" disabled={submitDisabled} className="btn btn-primary">
          {submitting ? "Posting..." : parentId ? "Reply" : "Post"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
