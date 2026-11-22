import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, isShortenerHost, type LinkVerdict } from './link-heuristics.ts';

const cases: Array<[string, LinkVerdict]> = [
  // ok
  ['https://github.com/jovylle/agentsquare', { status: 'ok', reason: 'heuristics_pass' }],
  ['HTTPS://EXAMPLE.COM/Path', { status: 'ok', reason: 'heuristics_pass' }],
  ['http://example.com:80/', { status: 'ok', reason: 'heuristics_pass' }],
  ['https://example.com:443', { status: 'ok', reason: 'heuristics_pass' }],
  ['https://example.com.', { status: 'ok', reason: 'heuristics_pass' }],
  ['https://x.y.example.com', { status: 'ok', reason: 'heuristics_pass' }],

  // bad_scheme
  ['javascript:alert(1)', { status: 'blocked', reason: 'bad_scheme' }],
  ['ftp://example.com', { status: 'blocked', reason: 'bad_scheme' }],
  ['mailto:someone@example.com', { status: 'blocked', reason: 'bad_scheme' }],
  ['file:///etc/passwd', { status: 'blocked', reason: 'bad_scheme' }],

  // unparseable
  ['not a url', { status: 'blocked', reason: 'unparseable' }],
  ['', { status: 'blocked', reason: 'unparseable' }],

  // userinfo
  ['http://user:pass@example.com', { status: 'blocked', reason: 'userinfo' }],
  ['https://user@example.com', { status: 'blocked', reason: 'userinfo' }],

  // odd_port
  ['https://example.com:8443', { status: 'blocked', reason: 'odd_port' }],
  ['http://example.com:8080/', { status: 'blocked', reason: 'odd_port' }],
  ['http://localhost:3000', { status: 'blocked', reason: 'odd_port' }],

  // ip_literal
  ['http://127.0.0.1/x', { status: 'blocked', reason: 'ip_literal' }],
  ['http://192.168.1.1/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://10.1.2.3:443/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://2130706433/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://0x7f000001/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://0177.0.0.1/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://1.2.3/', { status: 'blocked', reason: 'ip_literal' }],
  ['http://[::1]/', { status: 'blocked', reason: 'ip_literal' }],
  ['https://[2001:db8::1]/', { status: 'blocked', reason: 'ip_literal' }],

  // internal_host
  ['http://localhost/', { status: 'blocked', reason: 'internal_host' }],
  ['https://LOCALHOST./', { status: 'blocked', reason: 'internal_host' }],
  ['http://intranet.corp/x', { status: 'blocked', reason: 'internal_host' }],
  ['http://printer.local', { status: 'blocked', reason: 'internal_host' }],
  ['http://db.internal', { status: 'blocked', reason: 'internal_host' }],
  ['http://foo.localhost', { status: 'blocked', reason: 'internal_host' }],
  ['http://router.lan', { status: 'blocked', reason: 'internal_host' }],
  ['http://a.home.arpa', { status: 'blocked', reason: 'internal_host' }],
  ['http://singlelabel/', { status: 'blocked', reason: 'internal_host' }],

  // punycode
  ['https://xn--80ak6aa92e.com', { status: 'suspicious', reason: 'punycode' }],

  // shortener
  ['https://bit.ly/abc', { status: 'suspicious', reason: 'shortener' }],
  ['https://tinyurl.com/x', { status: 'suspicious', reason: 'shortener' }],
  ['https://www.t.co/x', { status: 'suspicious', reason: 'shortener' }],

  // many_subdomains (more than 4 labels)
  ['https://a.b.c.d.e.example.com', { status: 'suspicious', reason: 'many_subdomains' }],
  ['https://w.x.y.example.com', { status: 'suspicious', reason: 'many_subdomains' }],

  // risky_tld
  ['https://evil.zip', { status: 'suspicious', reason: 'risky_tld' }],
  ['https://foo.tk/login', { status: 'suspicious', reason: 'risky_tld' }],
];

describe('classifyUrl', () => {
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected.status} ${expected.reason}`, () => {
      assert.deepEqual(classifyUrl(input), expected);
    });
  }

  test('rule order: punycode wins over shortener and risky_tld', () => {
    assert.deepEqual(classifyUrl('https://xn--80ak6aa92e.zip'), { status: 'suspicious', reason: 'punycode' });
  });

  test('rule order: ip literal is checked before internal host', () => {
    assert.deepEqual(classifyUrl('http://127.0.0.1'), { status: 'blocked', reason: 'ip_literal' });
  });

  test('rule order: userinfo is checked before port', () => {
    assert.deepEqual(classifyUrl('http://u:p@example.com:8080'), { status: 'blocked', reason: 'userinfo' });
  });
});

describe('isShortenerHost', () => {
  test('matches listed hosts and their subdomains, case-insensitive, trailing dot ignored', () => {
    assert.equal(isShortenerHost('bit.ly'), true);
    assert.equal(isShortenerHost('www.bit.ly'), true);
    assert.equal(isShortenerHost('BIT.LY.'), true);
    assert.equal(isShortenerHost('shorturl.at'), true);
  });

  test('does not match lookalike or unrelated hosts', () => {
    assert.equal(isShortenerHost('notbit.ly'), false);
    assert.equal(isShortenerHost('example.com'), false);
    assert.equal(isShortenerHost('bit.ly.example.com'), false);
  });
});
