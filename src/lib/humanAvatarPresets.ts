/** Dicebear style for human profiles (agents use bottts). */
export const HUMAN_AVATAR_STYLE = "lorelei" as const;

const DICEBEAR_BASE = `https://api.dicebear.com/9.x/${HUMAN_AVATAR_STYLE}/svg`;

/** Pastel / saturated backgrounds PRNG can pick from (not flat grey). */
const BACKGROUND_COLORS =
  "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,f5d0c5,e8c5ff,a8e6cf,fceabb,ffb4a2,c1f7dc,89c2d9,f4acb7";

const HAIR_COLORS = "4a3728,2c1810,8b4513,d87a5c,6b5b95,3d5a80,c9a227,e8b4a0,f4a6b0,a67c52,6f4e37,5c4d7d,2d6a4f";

const SKIN_COLORS = "f8d9c4,f5cbb4,e8b89c,d4a574,ffe4d6,edc9af,c68642,f0c8a8,deb887";

const MOUTH_COLORS = "d4a574,c97b63,e8a090,b85c4e,f4a698,9e6b5c";

const EYEBROW_COLORS = "4a3728,6b4423,8b6914,5c4033,3d2914";

const EYE_COLORS = "2e5266,4a6741,6b4e71,3d5a80,8b4513,2f4f4f";

/** Same algorithm as `human_avatar_seed_checksum` in migration 0017 (char code sum). */
export function humanAvatarSeedChecksum(seed: string): number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s += seed.charCodeAt(i);
  return s;
}

function facetingFromSeed(seed: string): { flip: boolean; rotate: number } {
  const chk = humanAvatarSeedChecksum(seed);
  const flip = chk % 2 === 1;
  const tilts = [-8, -4, 0, 4, 8];
  const rotate = tilts[chk % tilts.length]!;
  return { flip, rotate };
}

/** Lorelei with colorful options, slight tilt/flip, and tighter crop (less neck). */
export function humanAvatarUrl(seed: string): string {
  const { flip, rotate } = facetingFromSeed(seed);
  const q = [
    `seed=${encodeURIComponent(seed)}`,
    "backgroundType=gradientLinear,solid",
    `backgroundColor=${BACKGROUND_COLORS}`,
    "backgroundRotation=0,360",
    `hairColor=${HAIR_COLORS}`,
    `skinColor=${SKIN_COLORS}`,
    `mouthColor=${MOUTH_COLORS}`,
    `eyebrowsColor=${EYEBROW_COLORS}`,
    `eyesColor=${EYE_COLORS}`,
    "scale=120",
    "translateY=-16",
    `rotate=${rotate}`,
    `flip=${flip}`,
  ].join("&");
  return `${DICEBEAR_BASE}?${q}`;
}

/** Same formula as `handle_new_user` / `human_lorelei_avatar_url` after migration 0017. */
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

/** Minimal lorelei URL (pre–0017); still accepted for updates until user picks again. */
export function legacyHumanAvatarUrl(seed: string): string {
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(seed)}`;
}

export function extractLoreleiSeedFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/lorelei/")) return null;
    const s = u.searchParams.get("seed");
    return s ? decodeURIComponent(s) : null;
  } catch {
    return null;
  }
}

export function canonicalHumanAvatarUrl(url: string | null): string | null {
  const seed = url ? extractLoreleiSeedFromUrl(url) : null;
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
  const seed = extractLoreleiSeedFromUrl(url);
  if (!seed || !isKnownHumanAvatarSeed(seed, handle)) return false;
  return url === humanAvatarUrl(seed) || url === legacyHumanAvatarUrl(seed);
}
