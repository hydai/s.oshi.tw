import { beforeEach, describe, expect, it } from 'vitest';
import { getAllMappings, getMapping, getMappingsBySlugs, putMapping, slugExists } from './kv';
import { fakeKV, mapping } from './test-support';

let kv: ReturnType<typeof fakeKV>;

beforeEach(() => {
  kv = fakeKV();
});

const seedMany = (n: number) => {
  for (let i = 0; i < n; i++) kv.seed(mapping({ slug: `s${i}`, title: `T${i}` }));
};

describe('getMappingsBySlugs', () => {
  it('reads 250 records in 3 bulk operations rather than 250', async () => {
    seedMany(250);
    kv.reset();

    const found = await getMappingsBySlugs(kv.kv, Array.from({ length: 250 }, (_, i) => `s${i}`));

    expect(found).toHaveLength(250);
    expect(kv.gets).toBe(3);
    expect(kv.largestBulkGet).toBeLessThanOrEqual(100);
  });

  it('preserves the requested order', async () => {
    seedMany(150);
    const slugs = ['s149', 's0', 's75'];
    const found = await getMappingsBySlugs(kv.kv, slugs);
    expect(found.map((m) => m.slug)).toEqual(slugs);
  });

  it('drops slugs that no longer exist', async () => {
    kv.seed(mapping({ slug: 'a' }), mapping({ slug: 'b' }));
    const found = await getMappingsBySlugs(kv.kv, ['a', 'gone', 'b']);
    expect(found.map((m) => m.slug)).toEqual(['a', 'b']);
  });

  it('touches KV not at all for an empty list', async () => {
    kv.reset();
    expect(await getMappingsBySlugs(kv.kv, [])).toEqual([]);
    expect(kv.gets).toBe(0);
  });

  it('chunks exactly at the 100-key boundary', async () => {
    seedMany(100);
    kv.reset();
    await getMappingsBySlugs(kv.kv, Array.from({ length: 100 }, (_, i) => `s${i}`));
    expect(kv.gets).toBe(1);

    seedMany(101);
    kv.reset();
    await getMappingsBySlugs(kv.kv, Array.from({ length: 101 }, (_, i) => `s${i}`));
    expect(kv.gets).toBe(2);
  });
});

describe('getAllMappings', () => {
  it('returns every record and ignores non-slug keys', async () => {
    seedMany(120);
    kv.store.set('index:listed', JSON.stringify(['s1']));
    kv.reset();

    const all = await getAllMappings(kv.kv);

    expect(all).toHaveLength(120);
    expect(all.every((m) => m.slug.startsWith('s'))).toBe(true);
    expect(kv.gets).toBe(2);
  });

  it('returns an empty array for an empty namespace', async () => {
    expect(await getAllMappings(kv.kv)).toEqual([]);
  });
});

describe('single-record helpers', () => {
  it('round-trips a mapping', async () => {
    const m = mapping({ slug: 'demo', title: 'Demo' });
    await putMapping(kv.kv, m);
    expect(await getMapping(kv.kv, 'demo')).toEqual(m);
    expect(await slugExists(kv.kv, 'demo')).toBe(true);
    expect(await slugExists(kv.kv, 'other')).toBe(false);
    expect(await getMapping(kv.kv, 'other')).toBeNull();
  });
});

describe('unreadable records', () => {
  // Reads used to ask KV for 'json', which parses inside the bulk call, so one
  // bad value threw and took every other record with it.
  const bad: [string, string][] = [
    ['invalid JSON', '{not json'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['an unknown status', JSON.stringify({ ...mapping({ slug: 'x' }), status: 'bogus' })],
    ['a prototype-key status', JSON.stringify({ ...mapping({ slug: 'x' }), status: 'constructor' })],
    ['a missing updatedAt', JSON.stringify({ ...mapping({ slug: 'x' }), updatedAt: undefined })],
    ['a non-boolean listed', JSON.stringify({ ...mapping({ slug: 'x' }), listed: 'yes' })],
  ];

  it.each(bad)('skips %s rather than failing the read', async (_label, raw) => {
    kv.store.set('slug:bad', raw);
    expect(await getMapping(kv.kv, 'bad')).toBeNull();
  });

  it.each(bad)('lets the good records through alongside %s', async (_label, raw) => {
    kv.seed(mapping({ slug: 'good1' }), mapping({ slug: 'good2' }));
    kv.store.set('slug:bad', raw);

    const all = await getAllMappings(kv.kv);
    expect(all.map((m) => m.slug).sort()).toEqual(['good1', 'good2']);
  });

  it('fills in display-only fields that are absent', async () => {
    const { description, photo, author, contact, notes, ...core } = mapping({ slug: 'sparse' });
    kv.store.set('slug:sparse', JSON.stringify(core));

    const m = await getMapping(kv.kv, 'sparse');
    expect(m).not.toBeNull();
    expect(m).toMatchObject({ slug: 'sparse', description: '', photo: '', author: '', contact: '', notes: '' });
  });

  it('accepts every status the app itself writes', async () => {
    for (const status of ['pending', 'approved', 'disabled', 'rejected'] as const) {
      kv.store.set('slug:s', JSON.stringify(mapping({ slug: 's', status })));
      expect((await getMapping(kv.kv, 's'))?.status).toBe(status);
    }
  });
});

describe('over-long keys', () => {
  // KV rejects a key over 512 bytes by throwing; no stored record can have one.
  it('reads a slug past the key limit as a miss', async () => {
    expect(await getMapping(kv.kv, 'a'.repeat(600))).toBeNull();
    expect(await slugExists(kv.kv, 'a'.repeat(600))).toBe(false);
  });

  it('still reads a slug that just fits', async () => {
    const slug = 'a'.repeat(507);
    kv.seed(mapping({ slug }));
    expect(await getMapping(kv.kv, slug)).not.toBeNull();
    expect(await slugExists(kv.kv, slug)).toBe(true);
  });

  it('measures bytes, not characters', async () => {
    expect(await getMapping(kv.kv, '中'.repeat(170))).toBeNull();
  });
});

