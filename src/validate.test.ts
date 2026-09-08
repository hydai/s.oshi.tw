import { describe, expect, it } from 'vitest';
import { canonicalSlug, couldBeSlug, validateSlug, validateSubmission, validateUrl } from './validate';

describe('canonicalSlug', () => {
  it.each([
    ['Admin', 'admin'],
    ['MyLink', 'mylink'],
    ['ｏｓｈｉ', 'oshi'],
    ['１２３', '123'],
    ['ｏＳＨｉ－ｔｗ'.normalize('NFC'), 'oshi-tw'],
    ['oshi', 'oshi'],
    ['子午計畫', '子午計畫'],
  ])('folds %j to %j', (raw, expected) => {
    expect(canonicalSlug(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const s of ['Admin', 'ｏｓｈｉ', '子午計畫', 'café'.normalize('NFD')]) {
      expect(canonicalSlug(canonicalSlug(s))).toBe(canonicalSlug(s));
    }
  });
});

describe('validateSlug', () => {
  it.each(['oshi', 'oshi-tw', 'a1', 'mpstore', 'sfstore', '子午計畫官方賣場', '推し', 'オシ', 'ラーメン', '推-oshi', 'a'.repeat(30)])(
    'accepts %j',
    (slug) => expect(validateSlug(slug)).toBe(true),
  );

  it.each([
    ['a', 'shorter than the minimum'],
    ['a'.repeat(31), 'longer than the maximum'],
    ['new', 'reserved'],
    ['admin', 'reserved'],
    ['Admin', 'not canonical, and would bypass the reserved list'],
    ['NEW', 'not canonical, and would bypass the reserved list'],
    ['MyLink', 'not canonical'],
    ['ｏｓｈｉ', 'not canonical'],
    ['оshi', 'Cyrillic homograph of oshi'],
    ['аdmin', 'Cyrillic homograph of the reserved admin'],
    ['ㅤㅤ', 'invisible Hangul fillers render as a blank link'],
    ['os​hi', 'zero-width space'],
    ['한글', 'Hangul is outside the allowlist'],
    ['-oshi', 'leading hyphen'],
    ['oshi-', 'trailing hyphen'],
    ['os--hi', 'doubled hyphen'],
    ['os hi', 'space'],
    ['os.hi', 'dot'],
    ['𠮷', 'one character, below the two-character minimum'],
    ['', 'empty'],
  ])('rejects %j (%s)', (slug) => expect(validateSlug(slug)).toBe(false));

  it('counts characters, not UTF-16 units', () => {
    const sixteenAstral = '𠮷'.repeat(16);
    expect(sixteenAstral.length).toBe(32);
    expect(Array.from(sixteenAstral).length).toBe(16);
    expect(validateSlug(sixteenAstral)).toBe(true);
    expect(validateSlug('𠮷'.repeat(31))).toBe(false);
  });

  it('accepts every slug already stored in production', () => {
    for (const slug of ['mpstore', 'sfstore', '子午計畫官方賣場']) {
      expect(canonicalSlug(slug)).toBe(slug);
      expect(validateSlug(slug)).toBe(true);
    }
  });
});

describe('couldBeSlug', () => {
  it.each(['oshi', 'mpstore', '子午計畫官方賣場', 'Anything-Old', 'оshi', '한글'])(
    'stays permissive for %j so live links keep resolving',
    (slug) => expect(couldBeSlug(slug)).toBe(true),
  );

  it.each(['favicon.ico', 'robots.txt', '.well-known', 'a b', 'a/b', ''])(
    'rejects %j before it costs a KV read',
    (path) => expect(couldBeSlug(path)).toBe(false),
  );

  it('rejects keys KV would refuse', () => {
    expect(couldBeSlug('a'.repeat(507))).toBe(true);
    expect(couldBeSlug('a'.repeat(508))).toBe(false);
    // 3 UTF-8 bytes each: 169 fits in the 507-byte budget, 170 does not.
    expect(couldBeSlug('中'.repeat(169))).toBe(true);
    expect(couldBeSlug('中'.repeat(170))).toBe(false);
  });
});

describe('validateUrl', () => {
  it.each(['https://example.com', 'http://example.com/a?b=c'])('accepts %j', (u) =>
    expect(validateUrl(u)).not.toBeNull(),
  );
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'not a url', ''])(
    'rejects %j',
    (u) => expect(validateUrl(u)).toBeNull(),
  );
});

describe('validateSubmission', () => {
  const base = { url: 'https://example.com', title: 'Example' };

  it('accepts a minimal submission', () => {
    const r = validateSubmission({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ url: 'https://example.com/', title: 'Example', slug: '', listed: false });
  });

  it('stores the canonical form of a custom slug', () => {
    const r = validateSubmission({ ...base, slug: 'ＭｙＬｉｎｋ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.slug).toBe('mylink');
  });

  it('rejects a slug that only looks like an existing one', () => {
    const r = validateSubmission({ ...base, slug: 'оshi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('slug');
  });

  it('reports every failing field at once', () => {
    const r = validateSubmission({ url: 'nope', title: '', slug: 'admin', description: 'd'.repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(['description', 'slug', 'title', 'url']);
  });

  it('treats a checked listed box as opt-in', () => {
    expect(validateSubmission({ ...base, listed: 'on' })).toMatchObject({ data: { listed: true } });
    expect(validateSubmission({ ...base, listed: 'off' })).toMatchObject({ data: { listed: false } });
  });
});
