import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { ADMIN_EMAIL, ORIGIN, adminHeaders, env, fakeKV, form, mapping } from './test-support';

type Kv = ReturnType<typeof fakeKV>;
let kv: Kv;

beforeEach(() => {
  kv = fakeKV();
});

const req = (path: string, init: RequestInit = {}, e = env(kv.kv)) =>
  app.request(ORIGIN + path, init, e);

const adminAction = (action: string, body: string, headers: Record<string, string> = adminHeaders()) =>
  req(`/admin/api/${action}`, { method: 'POST', headers, body });

describe('admin API CSRF', () => {
  beforeEach(() => {
    kv.seed(mapping({ slug: 'evil', status: 'pending', listed: true }));
  });

  // A cross-site form can only send form-style content types, and the Access
  // cookie is issued without SameSite, so these must not reach the handler.
  it.each([
    ['a cross-site Origin', { Origin: 'https://evil.example' }],
    ['no Origin header at all', { Origin: undefined as unknown as string }],
    ['a same-site but not same-origin Origin', { Origin: 'https://other.oshi.tw' }],
  ])('rejects a text/plain form POST with %s', async (_label, over) => {
    const headers: Record<string, string> = {
      'CF-Access-Authenticated-User-Email': ADMIN_EMAIL,
      'Content-Type': 'text/plain',
      ...over,
    };
    if (over.Origin === undefined) delete headers.Origin;

    const res = await adminAction('approve', '{"slug":"evil","x":"="}', headers);
    expect(res.status).toBe(403);
    expect(kv.read('evil').status).toBe('pending');
  });

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data'])(
    'rejects a cross-site %s POST',
    async (contentType) => {
      const res = await adminAction('approve', 'slug=evil', {
        'CF-Access-Authenticated-User-Email': ADMIN_EMAIL,
        'Content-Type': contentType,
        Origin: 'https://evil.example',
      });
      expect(res.status).toBe(403);
    },
  );

  it('allows the dashboard same-origin JSON fetch', async () => {
    const res = await adminAction('approve', '{"slug":"evil"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slug: 'evil' });
    expect(kv.read('evil').status).toBe('approved');
  });
});

describe('admin API body validation', () => {
  beforeEach(() => {
    kv.seed(mapping({ slug: 'a', status: 'pending', listed: true }));
    kv.store.set('index:listed', '[]');
  });

  it.each([
    ['malformed JSON', '{bad'],
    ['an empty body', ''],
    ['a null body', 'null'],
    ['an array slug', '{"slug":["a"]}'],
    ['a numeric slug', '{"slug":123}'],
    ['an object slug', '{"slug":{}}'],
    ['a missing slug', '{}'],
    ['an empty slug', '{"slug":""}'],
  ])('answers 400 JSON for %s', async (_label, body) => {
    const res = await adminAction('approve', body);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(kv.read('a').status).toBe('pending');
  });

  // A non-string slug used to transition the mapping while pushing a value
  // into the index that strict-equality removal could never delete.
  it('never lets a non-string slug reach the listed index', async () => {
    await adminAction('approve', '{"slug":["a"]}');
    expect(kv.index()).toEqual([]);
  });

  it('keeps only strings in the index on the happy path', async () => {
    await adminAction('approve', '{"slug":"a"}');
    expect(kv.index()).toEqual(['a']);
    await adminAction('disable', '{"slug":"a"}');
    expect(kv.index()).toEqual([]);
  });

  it('refuses a transition the state machine does not allow', async () => {
    await adminAction('approve', '{"slug":"a"}');
    const res = await adminAction('approve', '{"slug":"a"}');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it('answers 404 for an unknown slug', async () => {
    const res = await adminAction('approve', '{"slug":"ghost"}');
    expect(res.status).toBe(404);
  });

  // KV throws on a key over 512 bytes. A slug that long cannot name a stored
  // record, so it is a miss, not an internal error.
  it('answers 404 rather than 500 for an over-long slug', async () => {
    const res = await adminAction('approve', JSON.stringify({ slug: 'a'.repeat(600) }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});

describe('admin authorization', () => {
  const get = (host: string, e: Record<string, unknown>, headers = {}) =>
    app.request(`${host}/admin`, { headers }, e);

  it('rejects an anonymous request in production', async () => {
    expect((await get(ORIGIN, env(kv.kv))).status).toBe(401);
  });

  it('ignores DEV_AUTH_EMAIL on a public hostname', async () => {
    const res = await get(ORIGIN, env(kv.kv, { DEV_AUTH_EMAIL: ADMIN_EMAIL }));
    expect(res.status).toBe(401);
  });

  it.each(['http://localhost:8787', 'http://127.0.0.1:8787'])(
    'honours DEV_AUTH_EMAIL on %s',
    async (host) => {
      const res = await get(host, env(kv.kv, { DEV_AUTH_EMAIL: ADMIN_EMAIL }));
      expect(res.status).toBe(200);
    },
  );

  it('still requires the variable to be set locally', async () => {
    expect((await get('http://localhost:8787', env(kv.kv))).status).toBe(401);
  });

  it('accepts an allowed Access email and rejects any other', async () => {
    const headers = { 'CF-Access-Authenticated-User-Email': ADMIN_EMAIL };
    expect((await get(ORIGIN, env(kv.kv), headers)).status).toBe(200);
    const other = { 'CF-Access-Authenticated-User-Email': 'nope@example.com' };
    expect((await get(ORIGIN, env(kv.kv), other)).status).toBe(403);
  });
});

describe('status transitions', () => {
  const JAN = '2026-01-15T03:00:00.000Z';

  beforeEach(() => {
    kv.seed(mapping({ slug: 'old', status: 'approved', listed: true, createdAt: JAN, updatedAt: JAN, approvedAt: JAN }));
    kv.store.set('index:listed', JSON.stringify(['old']));
  });

  // approvedAt is the public listing's sort key and the only record of when a
  // link was approved, so a disable/enable cycle must not restamp it.
  it('keeps the original approvedAt across a disable and re-enable', async () => {
    expect((await adminAction('disable', '{"slug":"old"}')).status).toBe(200);
    expect(kv.read('old').approvedAt).toBe(JAN);

    expect((await adminAction('enable', '{"slug":"old"}')).status).toBe(200);
    expect(kv.read('old').approvedAt).toBe(JAN);
    expect(kv.read('old').status).toBe('approved');
  });

  it('still advances updatedAt on every transition', async () => {
    await adminAction('disable', '{"slug":"old"}');
    expect(kv.read('old').updatedAt).not.toBe(JAN);
  });

  it('stamps approvedAt on the first approval only', async () => {
    kv.seed(mapping({ slug: 'fresh', status: 'pending' }));
    expect(kv.read('fresh').approvedAt).toBeNull();
    await adminAction('approve', '{"slug":"fresh"}');
    expect(kv.read('fresh').approvedAt).not.toBeNull();
  });

  it('leaves the listing order stable after a re-enable', async () => {
    kv.seed(mapping({ slug: 'newer', status: 'approved', listed: true, title: 'Newer', approvedAt: '2026-05-01T00:00:00.000Z' }));
    kv.store.set('index:listed', JSON.stringify(['old', 'newer']));
    await adminAction('disable', '{"slug":"old"}');
    await adminAction('enable', '{"slug":"old"}');

    const body = await (await req('/')).text();
    expect(body.indexOf('Newer')).toBeLessThan(body.indexOf('Demo'));
  });

  it('removes a disabled mapping from the listed index and puts it back', async () => {
    await adminAction('disable', '{"slug":"old"}');
    expect(kv.index()).toEqual([]);
    await adminAction('enable', '{"slug":"old"}');
    expect(kv.index()).toEqual(['old']);
  });
});

describe('redirect', () => {
  beforeEach(() => {
    kv.seed(
      mapping({ slug: 'mylink', status: 'approved', approvedAt: '2026-01-01T00:00:00.000Z' }),
      mapping({ slug: 'waiting', status: 'pending' }),
      mapping({ slug: 'off', status: 'disabled' }),
    );
  });

  it('redirects an approved slug without caching it', async () => {
    const res = await req('/mylink');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/target');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['/MyLink', '/MYLINK', '/ＭｙＬｉｎｋ'])('resolves %s to the same link', async (path) => {
    const res = await req(encodeURI(path));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/target');
  });

  // Lookups go through canonicalSlug, so a key stored in a non-canonical form
  // under the older rules is not reachable. The live namespace held only
  // canonical keys when this changed, but the behaviour is worth pinning: if a
  // non-canonical key ever appears, it needs a re-key, not a silent 404.
  it('cannot reach a key stored in a non-canonical form', async () => {
    kv.store.set('slug:LegacyKey', JSON.stringify(mapping({ slug: 'LegacyKey', status: 'approved' })));
    expect(kv.store.has('slug:legacykey')).toBe(false);
    expect((await req('/LegacyKey')).status).toBe(404);
    expect((await req('/legacykey')).status).toBe(404);
  });

  it.each(['/waiting', '/off', '/nosuchthing'])('answers 404 for %s', async (path) => {
    const res = await req(path);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  // Probes used to cost a KV read each, and an over-long key made KV throw.
  it.each(['/favicon.ico', '/robots.txt', '/.well-known', '/a b'])(
    'answers %s without touching KV',
    async (path) => {
      kv.reset();
      const res = await req(encodeURI(path));
      expect(res.status).toBe(404);
      expect(kv.gets).toBe(0);
    },
  );

  it('answers an over-long path with 404 rather than letting KV throw', async () => {
    kv.reset();
    const res = await req('/' + 'a'.repeat(600));
    expect(res.status).toBe(404);
    expect(kv.gets).toBe(0);
  });

  // NFKC can expand a segment far past KV's 512-byte key limit, so the size
  // check has to run after canonicalization rather than on the raw path.
  it('answers 404 when canonicalization would expand the key past the KV limit', async () => {
    const raw = 'ﷺ'.repeat(169);
    expect(new TextEncoder().encode(raw).length).toBe(507);
    expect(new TextEncoder().encode('slug:' + raw.normalize('NFKC')).length).toBeGreaterThan(512);

    kv.reset();
    const res = await req('/' + encodeURIComponent(raw));
    expect(res.status).toBe(404);
    expect(kv.gets).toBe(0);
  });

  it('serves the branded page for a multi-segment path', async () => {
    const res = await req('/a/b');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('404');
  });
});

describe('failure handling', () => {
  const broken = () => env(fakeKV({ failWith: new Error('KV unavailable') }).kv);

  it('serves a styled 500 when a page cannot read KV', async () => {
    const res = await req('/', {}, broken());
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('answers JSON when an admin API call cannot read KV', async () => {
    const res = await adminAction('approve', '{"slug":"a"}', adminHeaders());
    const failing = await app.request(
      `${ORIGIN}/admin/api/approve`,
      { method: 'POST', headers: adminHeaders(), body: '{"slug":"a"}' },
      broken(),
    );
    expect(failing.status).toBe(500);
    expect(failing.headers.get('content-type')).toContain('application/json');
    expect(res.status).toBeGreaterThan(0);
  });

  it('answers JSON for an unknown admin API route', async () => {
    const res = await adminAction('nope', '{}');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('submission', () => {
  it('stores a pending mapping and redirects to the confirmation', async () => {
    const res = await req('/new', form({ url: 'https://example.com', title: 'Hello', slug: 'hello' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/new?submitted=hello');
    expect(kv.read('hello')).toMatchObject({ status: 'pending', approvedAt: null, listed: false });
  });

  it('stores the canonical slug and percent-encodes it in the Location', async () => {
    const res = await req('/new', form({ url: 'https://example.com', title: 'T', slug: 'ＭｙＬｉｎｋ' }));
    expect(res.headers.get('location')).toBe('/new?submitted=mylink');
    expect(kv.store.has('slug:mylink')).toBe(true);
  });

  it('keeps a non-ASCII slug out of the raw Location header', async () => {
    const res = await req('/new', form({ url: 'https://example.com', title: 'T', slug: '子午計畫' }));
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^[\x00-\x7F]*$/);
    expect(decodeURIComponent(location)).toBe('/new?submitted=子午計畫');
  });

  it.each([
    ['a Cyrillic homograph', 'оshi'],
    ['invisible Hangul fillers', 'ㅤㅤ'],
    ['a reserved word in capitals', 'Admin'],
  ])('refuses %s with a 400 and stores nothing', async (_label, slug) => {
    const res = await req('/new', form({ url: 'https://example.com', title: 'T', slug }));
    expect(res.status).toBe(400);
    expect([...kv.store.keys()].filter((k) => k.startsWith('slug:'))).toEqual([]);
  });

  it('rejects a duplicate slug with 409', async () => {
    kv.seed(mapping({ slug: 'taken' }));
    const res = await req('/new', form({ url: 'https://example.com', title: 'T', slug: 'taken' }));
    expect(res.status).toBe(409);
  });

  // parseBody yields File objects for file parts; validation expects strings.
  it('answers 400 rather than 500 when a field arrives as a file', async () => {
    const body = new FormData();
    body.set('url', new File(['x'], 'x.txt', { type: 'text/plain' }));
    body.set('title', 'Hello');
    const res = await req('/new', { method: 'POST', body });
    expect(res.status).toBe(400);
  });

  it('answers 400 for a multipart header with no boundary', async () => {
    const res = await req('/new', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: 'x=1',
    });
    expect(res.status).toBe(400);
  });

  it('generates a slug when none is given', async () => {
    const res = await req('/new', form({ url: 'https://example.com', title: 'T' }));
    expect(res.status).toBe(302);
    const slug = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('submitted')!;
    expect(slug).toMatch(/^[a-z0-9]{6}$/);
    expect(kv.store.has(`slug:${slug}`)).toBe(true);
  });
});

describe('listing', () => {
  it('shows only approved and opted-in mappings, newest approval first', async () => {
    kv.seed(
      mapping({ slug: 'new1', status: 'approved', listed: true, title: 'Newer', approvedAt: '2026-05-01T00:00:00.000Z' }),
      mapping({ slug: 'old1', status: 'approved', listed: true, title: 'Older', approvedAt: '2026-01-01T00:00:00.000Z' }),
      mapping({ slug: 'priv', status: 'approved', listed: false, title: 'Private' }),
      mapping({ slug: 'pend', status: 'pending', listed: true, title: 'Pending' }),
    );
    kv.store.set('index:listed', JSON.stringify(['new1', 'old1', 'priv', 'pend']));

    const body = await (await req('/')).text();
    expect(body).toContain('Newer');
    expect(body).toContain('Older');
    expect(body).not.toContain('Private');
    expect(body).not.toContain('Pending');
    expect(body.indexOf('Newer')).toBeLessThan(body.indexOf('Older'));
  });

  it('renders an empty state when nothing is listed', async () => {
    const body = await (await req('/')).text();
    expect(body).toContain('目前沒有公開的短網址');
  });
});
