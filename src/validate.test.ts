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

  // These pass the script allowlist on their own, so only the canonical-form
  // guard keeps a non-normalized variant from becoming a second key.
  it.each([
    ['ｱｲｳ', 'アイウ', 'halfwidth katakana'],
    ['⼅⼅', '亅亅', 'Kangxi radicals'],
    ['ｶﾞｷﾞ', 'ガギ', 'halfwidth katakana with voiced marks'],
  ])('rejects %j but accepts its canonical form %j (%s)', (raw, canonical) => {
    expect(canonicalSlug(raw)).toBe(canonical);
    expect(validateSlug(raw)).toBe(false);
    expect(validateSlug(canonical)).toBe(true);
  });

  it('accepts nothing it would not also accept after canonicalization', () => {
    for (let cp = 0x20; cp <= 0x2ffff; cp += 13) {
      const candidate = String.fromCodePoint(cp).repeat(2);
      if (validateSlug(candidate)) expect(canonicalSlug(candidate)).toBe(candidate);
    }
  });

  // The CJK Radicals Supplement is Script=Han and NFKC-stable, so without an
  // explicit refusal it offers a same-script homograph for every radical.
  it.each([
    ['⻤滅之刃', '鬼滅之刃', 'U+2EE4 CJK RADICAL GHOST'],
    ['⻩金', '黄金', 'U+2EE9 CJK RADICAL YELLOW'],
    ['⻄瓜', '西瓜', 'U+2EC4 CJK RADICAL WEST'],
  ])('rejects the radical lookalike %j while accepting %j (%s)', (lookalike, real) => {
    expect(canonicalSlug(lookalike)).toBe(lookalike);
    expect(validateSlug(lookalike)).toBe(false);
    expect(validateSlug(real)).toBe(true);
  });

  it('refuses the whole CJK Radicals Supplement block', () => {
    for (let cp = 0x2e80; cp <= 0x2eff; cp++) {
      expect(validateSlug(String.fromCodePoint(cp).repeat(2))).toBe(false);
    }
  });

  // ー renders as a dash, so on its own it would sidestep every hyphen rule.
  it.each(['ーoshi', 'oshiー', 'osーーhi', 'ーー', 'ーーーー'])('rejects %j, a dash-like slug with no kana', (slug) =>
    expect(validateSlug(slug)).toBe(false),
  );

  it.each(['ラーメン', 'コーヒー', 'ゲーム', 'すーぱー'])('still accepts %j, where ー is part of the word', (slug) =>
    expect(validateSlug(slug)).toBe(true),
  );

  it('counts characters, not UTF-16 units', () => {
    const sixteenAstral = '𠮷'.repeat(16);
    expect(sixteenAstral.length).toBe(32);
    expect(Array.from(sixteenAstral).length).toBe(16);
    expect(validateSlug(sixteenAstral)).toBe(true);
    expect(validateSlug('𠮷'.repeat(31))).toBe(false);
  });

  // Checked against the live namespace before the rules were tightened: these
  // were the only three keys, and all three were already canonical. This does
  // not generalise to any slug the old rule allowed, which is the point of the
  // migration test in app.test.ts.
  it('accepts the three slugs the live namespace held when the rules changed', () => {
    for (const slug of ['mpstore', 'sfstore', '子午計畫官方賣場']) {
      expect(canonicalSlug(slug)).toBe(slug);
      expect(validateSlug(slug)).toBe(true);
    }
  });
});

describe('couldBeSlug', () => {
  // couldBeSlug is only the cheap first stage. It passing does not mean the
  // path resolves: the canonical form still has to match a stored key.
  it.each(['oshi', 'mpstore', '子午計畫官方賣場', 'Anything-Old', 'оshi', '한글'])(
    'does not reject %j at the pre-filter stage',
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

  it('normalizes halfwidth katakana before storing it', () => {
    const r = validateSubmission({ url: 'https://example.com', title: 'T', slug: 'ｱｲｳ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.slug).toBe('アイウ');
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

