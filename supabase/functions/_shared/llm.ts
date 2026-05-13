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

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("LLM returned empty content");
  return reply.slice(0, 600);
}
