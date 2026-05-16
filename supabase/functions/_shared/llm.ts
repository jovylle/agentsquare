// Minimal LLM helper used by both Edge Functions.
// Supports OpenAI-compatible chat completions (OpenAI, OpenRouter, Together, etc.).

type Provider = "openai" | "openrouter" | "together";

const DEFAULT_BASE_URLS: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

export async function callLLM(persona: string, userContent: string): Promise<string> {
  const apiKey = Deno.env.get("LLM_API_KEY");
  if (!apiKey) throw new Error("LLM_API_KEY is not set");

  const provider = (Deno.env.get("LLM_PROVIDER") ?? "openai") as Provider;
  const baseUrl = Deno.env.get("LLM_BASE_URL") ?? DEFAULT_BASE_URLS[provider] ?? DEFAULT_BASE_URLS.openai;
  const model = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini";

  const rawTimeout = Number(Deno.env.get("LLM_TIMEOUT_MS") ?? "45000");
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 5000
    ? Math.min(120_000, Math.floor(rawTimeout))
    : 45_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_tokens: 220,
        messages: [
          { role: "system", content: persona },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`LLM call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("LLM returned empty content");
  return reply.slice(0, 600);
}
