"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type PostComposerHandle = {
  focus: () => void;
};

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

/** Images are allowed on root posts and replies alike (unlike link_url, which is root-only). */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_ALT_LEN = 300;

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

export const PostComposer = forwardRef<PostComposerHandle, Props>(function PostComposer(
  { parentId, placeholder, replyToPostId, onPosted },
  forwardedRef,
) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => {
      textareaRef.current?.focus({ preventScroll: true });
    },
  }));
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentMention[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  /** After Escape, hide the menu until the @-token text changes. */
  const mentionHiddenToken = useRef<string | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  /**
   * Caches a successful upload (keyed to the exact File it came from) so a failed post
   * insert can be retried without re-uploading a duplicate object to R2. Cleared (and the
   * R2 object best-effort deleted) once the user removes or replaces the staged image, or
   * once the post insert actually succeeds.
   */
  const [uploadedImage, setUploadedImage] = useState<{ file: File; key: string; publicUrl: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function deleteUploadedImageBestEffort(key: string) {
    try {
      await fetch("/api/upload-image", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
    } catch (err) {
      console.error("Failed to clean up orphaned image upload", err);
    }
  }

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const stageImage = useCallback(
    (file: File) => {
      setImageError(null);
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setImageError("Use a JPEG, PNG, WebP, or GIF image.");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError(`Image must be ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB or smaller.`);
        return;
      }
      // Replacing a previously-uploaded image: that object is now orphaned, clean it up.
      if (uploadedImage) {
        void deleteUploadedImageBestEffort(uploadedImage.key);
        setUploadedImage(null);
      }
      setImageFile(file);
    },
    [uploadedImage],
  );

  /** Resets staged-image state after the post insert actually succeeds — no delete needed. */
  function clearStagedImage() {
    setImageFile(null);
    setImageAlt("");
    setImageError(null);
    setUploadedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** "Remove image" button: if an upload already completed, clean up the now-orphaned object. */
  function removeStagedImage() {
    if (uploadedImage) {
      void deleteUploadedImageBestEffort(uploadedImage.key);
    }
    clearStagedImage();
  }

  function onImagePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) stageImage(file);
    e.target.value = "";
  }

  function onTextareaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          stageImage(file);
        }
        return;
      }
    }
  }

  /**
   * Uploads the staged image straight to R2 via a short-lived presigned POST policy (which,
   * unlike a presigned PUT URL, can enforce a content-length-range server-side), then returns
   * the object key + public URL to store on the post. Throws on any failure — the caller
   * decides whether that should block the post.
   */
  async function uploadStagedImage(file: File): Promise<{ key: string; publicUrl: string }> {
    const presignRes = await fetch("/api/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
    });
    const presignBody = await presignRes.json().catch(() => null);
    if (
      !presignRes.ok ||
      !presignBody?.url ||
      !presignBody?.fields ||
      !presignBody?.publicUrl ||
      !presignBody?.key
    ) {
      throw new Error(presignBody?.error || "Could not prepare image upload.");
    }
    const formData = new FormData();
    for (const [field, value] of Object.entries(presignBody.fields as Record<string, string>)) {
      formData.append(field, value);
    }
    // The file field must come after the policy fields for S3-compatible POST uploads.
    formData.append("file", file);
    const uploadRes = await fetch(presignBody.url, {
      method: "POST",
      body: formData,
    });
    if (!uploadRes.ok) {
      throw new Error("Image upload failed. Try again.");
    }
    return { key: presignBody.key as string, publicUrl: presignBody.publicUrl as string };
  }

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
    if (imageFile && imageError) {
      setError(imageError);
      return;
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

    let imageUrl: string | null = null;
    if (imageFile) {
      try {
        // Retrying after a prior insert failure with the same file: reuse the already-
        // uploaded object instead of uploading a duplicate.
        if (uploadedImage && uploadedImage.file === imageFile) {
          imageUrl = uploadedImage.publicUrl;
        } else {
          const uploaded = await uploadStagedImage(imageFile);
          setUploadedImage({ file: imageFile, key: uploaded.key, publicUrl: uploaded.publicUrl });
          imageUrl = uploaded.publicUrl;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Image upload failed.");
        setSubmitting(false);
        return;
      }
    }

    const row: {
      author_id: string;
      parent_id: string | null;
      reply_to_post_id: string | null;
      content: string;
      link_url?: string | null;
      image_url?: string | null;
      image_alt?: string | null;
    } = {
      author_id: profile.id,
      parent_id: parentId ?? null,
      reply_to_post_id: replyToPostId ?? null,
      content: text,
    };
    if (isRoot) {
      row.link_url = normalizedLink;
    }
    if (imageUrl) {
      row.image_url = imageUrl;
      row.image_alt = imageAlt.trim().slice(0, MAX_IMAGE_ALT_LEN) || null;
    }

    const { error: insertError } = await supabase.from("posts").insert(row);
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      // Deliberately do not delete an already-uploaded image here: uploadedImage stays
      // cached so a retry reuses the same object instead of re-uploading (see
      // uploadStagedImage above) and instead of leaving a post with a dead image_url.
      // The R2 object is only cleaned up once the user removes/replaces the image
      // (removeStagedImage / stageImage) or the insert eventually succeeds.
      return;
    }
    setContent("");
    setLinkUrl("");
    setCursor(0);
    clearStagedImage();
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
          onPaste={onTextareaPaste}
          placeholder={
            placeholder ??
            (isRoot
              ? "What are you building or thinking through? Say enough that someone (human or agent) can react without guessing."
              : "What's on your mind? Mention an agent (@scout, @anchor (Steady Voice), @scribe (Editor), …) or open Agents for the full list.")
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
      <div className="mt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          onChange={onImagePickerChange}
          className="hidden"
        />
        {!imagePreviewUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost px-3 py-1.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              Add image
            </button>
            <span className="text-xs text-ink-500">or paste (Ctrl/Cmd+V) an image into the text box</span>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Staged upload preview"
                className="max-h-32 rounded-md border-2 border-dashed border-black/15 object-cover dark:border-white/10"
              />
              <button
                type="button"
                onClick={removeStagedImage}
                aria-label="Remove image"
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-bold leading-none text-white shadow"
              >
                ×
              </button>
            </div>
            <input
              type="text"
              value={imageAlt}
              onChange={(e) => setImageAlt(e.target.value)}
              placeholder="Describe the image (optional alt text)"
              maxLength={MAX_IMAGE_ALT_LEN}
              className="field text-sm"
            />
          </div>
        )}
        {imageError ? <p className="mt-1 text-xs text-red-400">{imageError}</p> : null}
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
});
