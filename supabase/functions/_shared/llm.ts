// Minimal LLM helper used by both Edge Functions.
// Supports OpenAI-compatible chat completions (OpenAI, OpenRouter, Together, etc.).

type Provider = "openai" | "openrouter" | "together" | "nube";

const DEFAULT_BASE_URLS: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  nube: "https://ai.nube.sh/api/v1",
};

type AttemptConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

// gpt-5/o-series models are reasoning models: they reject custom `temperature`, use
// `max_completion_tokens` instead of `max_tokens`, and will happily burn the whole
// completion budget on hidden reasoning_content before ever emitting visible content
// unless reasoning_effort is capped low.
const OPENAI_REASONING_MODEL_PREFIXES = ["gpt-5", "o1", "o3", "o4"];

function isOpenAIReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();
  return OPENAI_REASONING_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function buildRequestBody(model: string, persona: string, userContent: string) {
  const messages = [
    { role: "system", content: persona },
    { role: "user", content: userContent },
  ];

  if (isOpenAIReasoningModel(model)) {
    return { model, max_completion_tokens: 600, reasoning_effort: "low", messages };
  }

  // Non-OpenAI-reasoning models (incl. Kimi K2.6 via nube.sh) still emit hidden
  // reasoning_content that counts against max_tokens with no effort knob, so the
  // budget needs enough headroom to reach visible content, not just the final reply.
  return { model, temperature: 0.8, max_tokens: 600, messages };
}

async function attemptChatCompletion(
  cfg: AttemptConfig,
  persona: string,
  userContent: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(cfg.model, persona, userContent)),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`LLM call timed out after ${cfg.timeoutMs}ms`);
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

// Primary provider comes from LLM_PROVIDER/LLM_MODEL/LLM_API_KEY (e.g. nube.sh + Kimi K2.6).
// Any failure (network error, timeout, non-2xx, empty content) falls back once to
// LLM_FALLBACK_PROVIDER/LLM_FALLBACK_MODEL/LLM_FALLBACK_API_KEY (e.g. OpenAI GPT-5-nano),
// only if a fallback API key is configured.
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

  try {
    return await attemptChatCompletion({ apiKey, baseUrl, model, timeoutMs }, persona, userContent);
  } catch (primaryErr) {
    const fallbackApiKey = Deno.env.get("LLM_FALLBACK_API_KEY");
    if (!fallbackApiKey) throw primaryErr;

    console.error(`primary LLM call failed (${provider}/${model}), falling back`, primaryErr);

    const fallbackProvider = (Deno.env.get("LLM_FALLBACK_PROVIDER") ?? "openai") as Provider;
    const fallbackBaseUrl = Deno.env.get("LLM_FALLBACK_BASE_URL") ??
      DEFAULT_BASE_URLS[fallbackProvider] ??
      DEFAULT_BASE_URLS.openai;
    const fallbackModel = Deno.env.get("LLM_FALLBACK_MODEL") ?? "gpt-5-nano";

    return await attemptChatCompletion(
      { apiKey: fallbackApiKey, baseUrl: fallbackBaseUrl, model: fallbackModel, timeoutMs },
      persona,
      userContent,
    );
  }
}
