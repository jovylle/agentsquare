/** Dicebear style for human profiles (agents use bottts). */
export const HUMAN_AVATAR_STYLE = "identicon" as const;

const DICEBEAR_BASE = `https://api.dicebear.com/9.x/${HUMAN_AVATAR_STYLE}/svg`;

/** Deterministic geometric identicon (same host as agents’ bottts). */
export function humanAvatarUrl(seed: string): string {
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(seed)}`;
}

/** Same formula as `human_identicon_avatar_url` / `handle_new_user` in migration 0018. */
export function defaultHumanAvatarUrl(handle: string): string {
  return humanAvatarUrl(handle);
}

/** Fixed seeds for the profile preset gallery. */
export const HUMAN_AVATAR_GALLERY_SEEDS = [
  "delta",
  "ember",
  "frost",
  "harbor",
  "iris",
  "juniper",
  "kelp",
  "lotus",
  "mesa",
  "nova",
  "opal",
  "prism",
  "quartz",
  "reef",
  "saffron",
  "tide",
] as const;

export const HUMAN_AVATAR_GALLERY: readonly string[] = HUMAN_AVATAR_GALLERY_SEEDS.map((s) =>
  humanAvatarUrl(s),
);

/** Legacy Lorelei URL with only `seed` (pre-identicon migrations). */
export function legacyMinimalLoreleiAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(seed)}`;
}

/** Parse `seed` from Dicebear identicon or legacy Lorelei human URLs. */
export function extractHumanAvatarSeedFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/identicon/") && !u.pathname.includes("/lorelei/")) return null;
    const s = u.searchParams.get("seed");
    return s ? decodeURIComponent(s) : null;
  } catch {
    return null;
  }
}

export function canonicalHumanAvatarUrl(url: string | null): string | null {
  const seed = url ? extractHumanAvatarSeedFromUrl(url) : null;
  if (!seed) return null;
  return humanAvatarUrl(seed);
}

/** Default first, then gallery presets; dedupes if handle matches a gallery seed. */
export function humanAvatarChoicesForHandle(handle: string): readonly string[] {
  const def = defaultHumanAvatarUrl(handle);
  const rest = HUMAN_AVATAR_GALLERY.filter((u) => u !== def);
  return [def, ...rest];
}

function isKnownHumanAvatarSeed(seed: string, handle: string): boolean {
  return seed === handle || (HUMAN_AVATAR_GALLERY_SEEDS as readonly string[]).includes(seed);
}

export function isAllowedHumanAvatarUrl(url: string, handle: string): boolean {
  const seed = extractHumanAvatarSeedFromUrl(url);
  if (!seed || !isKnownHumanAvatarSeed(seed, handle)) return false;
  return url === humanAvatarUrl(seed) || url === legacyMinimalLoreleiAvatarUrl(seed);
}
