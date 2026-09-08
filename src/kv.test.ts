import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToListedIndex,
  getAllMappings,
  getListedIndex,
  getMapping,
  getMappingsBySlugs,
  putMapping,
  removeFromListedIndex,
  slugExists,
} from './kv';
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

describe('listed index', () => {
  it('treats a missing key as empty', async () => {
    expect(await getListedIndex(kv.kv)).toEqual([]);
  });

  it('adds without duplicating and removes cleanly', async () => {
    await addToListedIndex(kv.kv, 'a');
    await addToListedIndex(kv.kv, 'a');
    await addToListedIndex(kv.kv, 'b');
    expect(await getListedIndex(kv.kv)).toEqual(['a', 'b']);

    await removeFromListedIndex(kv.kv, 'a');
    expect(await getListedIndex(kv.kv)).toEqual(['b']);
  });

  it('does not write when nothing would change', async () => {
    await addToListedIndex(kv.kv, 'a');
    kv.reset();
    await addToListedIndex(kv.kv, 'a');
    await removeFromListedIndex(kv.kv, 'absent');
    expect(kv.puts).toBe(0);
  });
});
