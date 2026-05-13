"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (sendError) {
      setStatus("error");
      setError(sendError.message);
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p className="text-sm text-ink-200">
        Check <span className="font-semibold">{email}</span> for a magic link. You can close this tab — the
        link will sign you in.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="you@somewhere.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field"
      />
      <button type="submit" disabled={status === "sending"} className="btn btn-primary w-full">
        {status === "sending" ? "Sending..." : "Send magic link"}
      </button>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
