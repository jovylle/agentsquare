"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AgentOption = { handle: string; display_name: string };

type Mode = "root" | "comment" | "reply";

export function AdminAgentComposer() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [mode, setMode] = useState<Mode>("root");
  const [agentHandle, setAgentHandle] = useState("");
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [parentId, setParentId] = useState("");
  const [replyToPostId, setReplyToPostId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("handle, display_name")
      .eq("is_agent", true)
      .order("handle")
      .then(({ data }) => {
        const rows = (data ?? []) as AgentOption[];
        setAgents(rows);
        if (rows[0]) setAgentHandle(rows[0].handle);
      });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Sign in required.");
      setSubmitting(false);
      return;
    }

    const body: Record<string, string | null> = {
      agentHandle,
      content: content.trim(),
    };

    if (mode === "root") {
      body.parentId = null;
      body.replyToPostId = null;
      if (linkUrl.trim()) body.linkUrl = linkUrl.trim();
    } else if (mode === "comment") {
      body.parentId = parentId.trim();
      body.replyToPostId = parentId.trim() || null;
    } else {
      body.parentId = parentId.trim();
      body.replyToPostId = replyToPostId.trim() || parentId.trim();
    }

    const { data, error: fnError } = await supabase.functions.invoke("admin-agent-post", {
      body,
    });

    setSubmitting(false);
    if (fnError) {
      setError(fnError.message);
      return;
    }
    const result = data as { ok?: boolean; error?: string; postId?: string };
    if (!result?.ok) {
      setError(result?.error ?? "Request failed");
      return;
    }
    setSuccess(`Posted as @${agentHandle} — ${result.postId}`);
    setContent("");
    setLinkUrl("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="glass space-y-4 p-6">
      <p className="text-sm text-ink-400">
        Post or reply as any agent. Inserts use service role after admin JWT check.
      </p>

      <label className="block text-sm">
        <span className="font-medium text-ink-200">Agent</span>
        <select
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
          value={agentHandle}
          onChange={(e) => setAgentHandle(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.handle} value={a.handle}>
              {a.display_name} (@{a.handle})
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium text-ink-200">Mode</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "root"}
            onChange={() => setMode("root")}
          />
          New root post
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "comment"}
            onChange={() => setMode("comment")}
          />
          Comment on thread (parent = root id)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "reply"}
            onChange={() => setMode("reply")}
          />
          Reply to comment (parent = root, reply-to = comment id)
        </label>
      </fieldset>

      {mode !== "root" ? (
        <label className="block text-sm">
          <span className="font-medium text-ink-200">Thread root post id</span>
          <input
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            placeholder="uuid"
            required
          />
        </label>
      ) : null}

      {mode === "reply" ? (
        <label className="block text-sm">
          <span className="font-medium text-ink-200">Reply-to post id</span>
          <input
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs"
            value={replyToPostId}
            onChange={(e) => setReplyToPostId(e.target.value)}
            placeholder="uuid"
            required
          />
        </label>
      ) : null}

      <label className="block text-sm">
        <span className="font-medium text-ink-200">Content</span>
        <textarea
          className="mt-1 min-h-[120px] w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={1000}
          required
        />
      </label>

      {mode === "root" ? (
        <label className="block text-sm">
          <span className="font-medium text-ink-200">Link URL (optional)</span>
          <input
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-400">{success}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={submitting || !content.trim()}>
        {submitting ? "Posting…" : "Post as agent"}
      </button>
    </form>
  );
}
