// Pure link heuristics for Link Guard. No imports and no Deno APIs, so Node can test it.
// Rules run in order; the first match wins. Anything that does not match is 'ok'.

export type LinkVerdict = { status: 'ok' | 'suspicious' | 'blocked'; reason: string };

const SHORTENER_HOSTS = [
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'lnkd.in',
  'shorturl.at',
  'tiny.cc',
];

const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.corp', '.lan', '.home.arpa', '.intranet'];

const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'click', 'gq', 'tk', 'ml', 'cf', 'ga']);

const MAX_LABELS = 4;

function blocked(reason: string): LinkVerdict {
  return { status: 'blocked', reason };
}

function suspicious(reason: string): LinkVerdict {
  return { status: 'suspicious', reason };
}

function normalizeHost(host: string): string {
  let h = host.toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

export function isShortenerHost(host: string): boolean {
  const h = normalizeHost(host);
  return SHORTENER_HOSTS.some((s) => h === s || h.endsWith('.' + s));
}

// URL already normalizes most IPv4 forms (decimal, hex, octal, short) to dotted decimal.
// Anything that is still all digits and dots is an IP literal; so is any 0x-prefixed host.
// IPv6 hostnames keep their brackets in URL.hostname.
function isIpLiteral(host: string): boolean {
  if (host.startsWith('[')) return true;
  return /^[0-9.]+$/.test(host) || /^0x[0-9a-f.]*$/.test(host);
}

function isInternalHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (!host.includes('.')) return true;
  return INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function classifyUrl(raw: string): LinkVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return blocked('unparseable');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return blocked('bad_scheme');
  }

  if (url.username !== '' || url.password !== '') {
    return blocked('userinfo');
  }

  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return blocked('odd_port');
  }

  const host = normalizeHost(url.hostname);
  if (host === '') {
    return blocked('unparseable');
  }

  if (isIpLiteral(host)) {
    return blocked('ip_literal');
  }

  if (isInternalHost(host)) {
    return blocked('internal_host');
  }

  const labels = host.split('.');

  if (labels.some((label) => label.startsWith('xn--'))) {
    return suspicious('punycode');
  }

  if (isShortenerHost(host)) {
    return suspicious('shortener');
  }

  if (labels.length > MAX_LABELS) {
    return suspicious('many_subdomains');
  }

  if (RISKY_TLDS.has(labels[labels.length - 1])) {
    return suspicious('risky_tld');
  }

  return { status: 'ok', reason: 'heuristics_pass' };
}
