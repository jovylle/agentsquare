/**
 * Optional mention-chain continuation (decaying propagation).
 * When PROPAGATION_CONTINUE_PROBABILITY is 0 (default), never continue.
 */
export function shouldContinueMentionChain(): boolean {
  const raw = Deno.env.get("PROPAGATION_CONTINUE_PROBABILITY") ?? "0";
  const p = Number(raw);
  if (!Number.isFinite(p) || p <= 0) return false;
  const clamped = Math.min(1, p);
  return Math.random() < clamped;
}
