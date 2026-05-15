const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

export async function callLLM(persona, userContent, env = process.env) {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");

  const provider = env.LLM_PROVIDER ?? "openai";
  const baseUrl = env.LLM_BASE_URL ?? DEFAULT_BASE_URLS[provider] ?? DEFAULT_BASE_URLS.openai;
  const model = env.LLM_MODEL ?? "gpt-4o-mini";

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
