// Link Guard checker. Triggered by a DB webhook on public.posts INSERT (0029) and by sweep calls.
// No shared secret: this function never trusts URLs from the request body. It only reads
// posts with link_status = 'pending' by id (or the oldest pending posts) and writes verdicts
// with the service role.

import { adminClient } from "../_shared/supabase.ts";
import { classifyUrl, isShortenerHost, type LinkVerdict } from "../_shared/link-heuristics.ts";

const MAX_REDIRECTS = 3;
const MAX_ATTEMPTS = 3;
const MAX_SWEEP = 10;
const FETCH_TIMEOUT_MS = 4000;
const USER_AGENT = "AgentSquareLinkGuard/1.0";
const SAFE_BROWSING_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const SAFE_BROWSING_API_KEY = Deno.env.get("SAFE_BROWSING_API_KEY");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = ReturnType<typeof adminClient>;
type PostRow = { id: string; link_url: string | null; link_attempts: number | null };

type Decision =
  | { kind: "verdict"; status: LinkVerdict["status"]; reason: string; finalUrl: string }
  | { kind: "retry"; reason: string; finalUrl: string };

type Result = { id: string; status: string; reason: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorName(err: unknown): string {
  // Only the error name is logged: fetch errors can contain the request URL (and the API key).
  return err instanceof Error ? err.name : "unknown";
}

function worse(a: LinkVerdict, b: LinkVerdict): LinkVerdict {
  const rank = { ok: 0, suspicious: 1, blocked: 2 } as const;
  return rank[b.status] > rank[a.status] ? b : a;
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore: body already closed
  }
}

// One HEAD request (GET if HEAD is refused). Returns the Location header for a redirect, else null.
// Throws on network error or timeout.
async function probeLocation(url: string): Promise<string | null> {
  const init = (method: string): RequestInit => ({
    method,
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  let res = await fetch(url, init("HEAD"));
  if (res.status === 405 || res.status === 501) {
    await discardBody(res);
    res = await fetch(url, init("GET"));
  }

  const location = isRedirect(res.status) ? res.headers.get("location") : null;
  await discardBody(res);
  return location;
}

async function safeBrowsingMatch(apiKey: string, urls: string[]): Promise<boolean> {
  const unique = [...new Set(urls)].map((url) => ({ url }));
  const res = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      client: { clientId: "agentsquare", clientVersion: "1.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: unique,
      },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    await discardBody(res);
    throw new Error(`safe_browsing_http_${res.status}`);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) {
    throw new Error("safe_browsing_bad_body");
  }
  const matches = (data as { matches?: unknown }).matches;
  return Array.isArray(matches) && matches.length > 0;
}

// Decides the final verdict for one link. Only network, timeout, or Safe Browsing failures
// produce 'retry'; the caller decides whether that becomes 'check_failed' or stays pending.
async function decide(raw: string): Promise<Decision> {
  const first = classifyUrl(raw);
  if (first.status === "blocked") {
    return { kind: "verdict", status: "blocked", reason: first.reason, finalUrl: raw };
  }

  const originIsShortener = isShortenerHost(hostOf(raw));
  let current = raw;
  let worst: LinkVerdict = first;
  let redirects = 0;
  let tooManyRedirects = false;

  try {
    for (;;) {
      const location = await probeLocation(current);
      if (location === null) break;

      if (redirects >= MAX_REDIRECTS) {
        // worst is never 'blocked' here (blocked returns early), so this is always suspicious.
        tooManyRedirects = true;
        worst = { status: "suspicious", reason: "too_many_redirects" };
        break;
      }
      redirects += 1;

      let target: string;
      try {
        target = new URL(location, current).href;
      } catch {
        return { kind: "verdict", status: "blocked", reason: "redirect_to_blocked:unparseable", finalUrl: current };
      }

      const targetVerdict = classifyUrl(target);
      if (targetVerdict.status === "blocked") {
        return {
          kind: "verdict",
          status: "blocked",
          reason: `redirect_to_blocked:${targetVerdict.reason}`,
          finalUrl: current,
        };
      }

      worst = worse(worst, targetVerdict);
      current = target;
    }

    if (worst.status !== "blocked" && SAFE_BROWSING_API_KEY) {
      const matched = await safeBrowsingMatch(SAFE_BROWSING_API_KEY, [raw, current]);
      if (matched) {
        return { kind: "verdict", status: "blocked", reason: "safe_browsing", finalUrl: current };
      }
    }
  } catch (err) {
    console.warn("link-guard: check failed", errorName(err));
    return { kind: "retry", reason: "check_failed", finalUrl: current };
  }

  if (worst.status !== "blocked" && originIsShortener && !tooManyRedirects && classifyUrl(current).status === "ok") {
    return { kind: "verdict", status: "ok", reason: "shortener_resolved", finalUrl: current };
  }

  return { kind: "verdict", status: worst.status, reason: worst.reason, finalUrl: current };
}

async function writeVerdict(
  admin: Admin,
  id: string,
  status: LinkVerdict["status"],
  reason: string,
  attempts: number,
  finalUrl: string,
): Promise<void> {
  const { error } = await admin
    .from("posts")
    .update({
      link_status: status,
      link_reason: reason,
      link_checked_at: new Date().toISOString(),
      link_attempts: attempts,
      link_final_url: finalUrl,
    })
    .eq("id", id)
    .eq("link_status", "pending");
  if (error) throw new Error("verdict_write_failed");
}

async function writeAttempts(
  admin: Admin,
  id: string,
  attempts: number,
): Promise<void> {
  const { error } = await admin
    .from("posts")
    .update({ link_attempts: attempts })
    .eq("id", id)
    .eq("link_status", "pending");
  if (error) throw new Error("attempts_write_failed");
}

async function checkPost(
  admin: Admin,
  row: PostRow,
): Promise<Omit<Result, "id">> {
  const attempts = (Number(row.link_attempts) || 0) + 1;
  const decision = await decide(row.link_url ?? "");

  if (decision.kind === "retry") {
    if (attempts < MAX_ATTEMPTS) {
      await writeAttempts(admin, row.id, attempts);
      return { status: "pending", reason: decision.reason };
    }
    await writeVerdict(admin, row.id, "suspicious", "check_failed", attempts, decision.finalUrl);
    return { status: "suspicious", reason: "check_failed" };
  }

  await writeVerdict(admin, row.id, decision.status, decision.reason, attempts, decision.finalUrl);
  return { status: decision.status, reason: decision.reason };
}

type Mode = { mode: "id"; id: string } | { mode: "sweep" };

function parseBody(body: unknown): Mode | null {
  if (typeof body !== "object" || body === null) return null;
  const { id, sweep } = body as { id?: unknown; sweep?: unknown };
  if (id !== undefined) {
    return typeof id === "string" && UUID_RE.test(id) ? { mode: "id", id } : null;
  }
  return sweep === true ? { mode: "sweep" } : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = parseBody(body);
  if (!parsed) {
    return jsonResponse({ ok: false, error: "expected id (uuid) or sweep: true" }, 400);
  }

  const admin = adminClient();
  const pending = admin
    .from("posts")
    .select("id, link_url, link_attempts")
    .eq("link_status", "pending");

  const { data, error } =
    parsed.mode === "id"
      ? await pending.eq("id", parsed.id)
      : await pending.order("created_at", { ascending: true }).limit(MAX_SWEEP);

  if (error) {
    console.error("link-guard: pending query failed");
    return jsonResponse({ ok: false, error: "query_failed" }, 500);
  }

  const rows = (data ?? []) as PostRow[];
  const results: Result[] = [];

  for (const row of rows) {
    try {
      const outcome = await checkPost(admin, row);
      results.push({ id: row.id, ...outcome });
    } catch (err) {
      console.error("link-guard: post failed", errorName(err));
      results.push({ id: row.id, status: "pending", reason: "error" });
    }
  }

  return jsonResponse({ ok: true, processed: results.length, results });
});
