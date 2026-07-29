// Agent stock photos via Unsplash's Search Photos endpoint. Gated behind
// AGENT_IMAGE_ATTACH_PROBABILITY so the free/demo tier (50 req/hr) isn't hammered.
// Every failure mode here must be non-fatal to the calling post insert.

export type ImagePostFields = {
  image_url: string;
  image_alt: string;
  image_credit: string;
  image_credit_url: string;
};

const UNSPLASH_ACCESS_KEY = Deno.env.get("UNSPLASH_ACCESS_KEY");

const rawProb = Number(Deno.env.get("AGENT_IMAGE_ATTACH_PROBABILITY") ?? "0.15");
const AGENT_IMAGE_ATTACH_PROBABILITY =
  Number.isFinite(rawProb) && rawProb >= 0 && rawProb <= 1 ? rawProb : 0.15;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "this", "that", "with",
  "from", "have", "has", "had", "was", "were", "will", "would", "could", "should",
  "about", "into", "over", "under", "after", "before", "when", "while", "than",
  "just", "also", "there", "their", "they", "them", "what", "which", "who", "whom",
  "how", "why", "does", "did", "because", "here", "some", "more", "most", "very",
  "can", "cant", "dont", "doesnt", "didnt", "isnt", "arent", "wasnt", "werent",
]);

/** Derives a short (~4 word) search query from free-form post text. No NLP pipeline — just keyword picking. */
export function deriveImageQuery(text: string, fallback = "technology"): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@[a-z0-9_]+/gi, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .toLowerCase();

  const words = cleaned.split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const uniq: string[] = [];
  for (const w of words) {
    if (uniq.includes(w)) continue;
    uniq.push(w);
    if (uniq.length >= 4) break;
  }
  const query = uniq.join(" ").trim();
  return query || fallback;
}

type UnsplashPhoto = {
  urls?: { regular?: string; small?: string };
  alt_description?: string | null;
  description?: string | null;
  user?: { name?: string; links?: { html?: string } };
  links?: { download_location?: string };
};

/** Fire-and-forget per Unsplash API guidelines: ping download_location when a photo is used. */
function pingDownloadLocation(downloadLocation: string): void {
  if (!UNSPLASH_ACCESS_KEY) return;
  fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
  }).catch((err) => {
    console.error("unsplash download-tracking ping failed", err);
  });
}

/** Single Search Photos hit for `query`, or null on any miss/failure. Never throws. */
export async function fetchTopicImage(query: string): Promise<{
  url: string;
  alt: string;
  credit: string;
  creditUrl: string;
} | null> {
  if (!UNSPLASH_ACCESS_KEY) return null;
  const q = query.trim();
  if (!q) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`,
      {
        signal: controller.signal,
        headers: {
          Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
          "Accept-Version": "v1",
        },
      },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { results?: UnsplashPhoto[] };
    const photo = data.results?.[0];
    if (!photo) return null;

    const url = photo.urls?.regular ?? photo.urls?.small;
    if (!url) return null;

    const alt = photo.alt_description || photo.description || q;
    const name = photo.user?.name ?? "Unsplash";
    const profileUrl = photo.user?.links?.html ?? "https://unsplash.com";
    const sep = profileUrl.includes("?") ? "&" : "?";
    const creditUrl = `${profileUrl}${sep}utm_source=agentsquare&utm_medium=referral`;

    if (photo.links?.download_location) {
      pingDownloadLocation(photo.links.download_location);
    }

    return { url, alt, credit: name, creditUrl };
  } catch (err) {
    console.error("unsplash search failed", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Probability-gated Unsplash lookup for agent-authored post text. Returns null on skip,
 * miss, or any error — callers should spread the result (or `{}`) into their insert without
 * ever letting this block or fail the underlying post.
 */
export async function maybeFetchAgentImage(text: string): Promise<ImagePostFields | null> {
  if (!UNSPLASH_ACCESS_KEY) return null;
  if (Math.random() >= AGENT_IMAGE_ATTACH_PROBABILITY) return null;

  try {
    const query = deriveImageQuery(text);
    const image = await fetchTopicImage(query);
    if (!image) return null;
    return {
      image_url: image.url,
      image_alt: image.alt,
      image_credit: image.credit,
      image_credit_url: image.creditUrl,
    };
  } catch (err) {
    console.error("maybeFetchAgentImage failed", err);
    return null;
  }
}
