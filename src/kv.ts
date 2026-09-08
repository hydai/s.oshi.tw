import type { Mapping } from './types';

const SLUG_PREFIX = 'slug:';
const INDEX_LISTED = 'index:listed';
const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 6;
const MAX_RETRIES = 5;

// A bulk get accepts up to 100 keys and counts as a single KV operation, so
// chunking keeps both list pages far below the per-invocation operation cap
// that one read per record would otherwise walk into.
const BULK_GET_LIMIT = 100;

export async function getMapping(kv: KVNamespace, slug: string): Promise<Mapping | null> {
  return kv.get<Mapping>(`${SLUG_PREFIX}${slug}`, 'json');
}

export async function putMapping(kv: KVNamespace, mapping: Mapping): Promise<void> {
  await kv.put(`${SLUG_PREFIX}${mapping.slug}`, JSON.stringify(mapping));
}

export async function slugExists(kv: KVNamespace, slug: string): Promise<boolean> {
  const val = await kv.get(`${SLUG_PREFIX}${slug}`);
  return val !== null;
}

function randomSlug(): string {
  let result = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    result += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return result;
}

export async function generateSlug(kv: KVNamespace): Promise<string | null> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const slug = randomSlug();
    if (!(await slugExists(kv, slug))) return slug;
  }
  return null;
}

export async function getListedIndex(kv: KVNamespace): Promise<string[]> {
  const data = await kv.get<string[]>(INDEX_LISTED, 'json');
  return data ?? [];
}

export async function putListedIndex(kv: KVNamespace, slugs: string[]): Promise<void> {
  await kv.put(INDEX_LISTED, JSON.stringify(slugs));
}

export async function addToListedIndex(kv: KVNamespace, slug: string): Promise<void> {
  const slugs = await getListedIndex(kv);
  if (!slugs.includes(slug)) {
    slugs.push(slug);
    await putListedIndex(kv, slugs);
  }
}

export async function removeFromListedIndex(kv: KVNamespace, slug: string): Promise<void> {
  const slugs = await getListedIndex(kv);
  const filtered = slugs.filter((s) => s !== slug);
  if (filtered.length !== slugs.length) {
    await putListedIndex(kv, filtered);
  }
}

export async function getMappingsBySlugs(kv: KVNamespace, slugs: string[]): Promise<Mapping[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < slugs.length; i += BULK_GET_LIMIT) {
    chunks.push(slugs.slice(i, i + BULK_GET_LIMIT).map((s) => `${SLUG_PREFIX}${s}`));
  }

  const fetched = await Promise.all(chunks.map((keys) => kv.get<Mapping>(keys, 'json')));

  // Preserve the caller's slug order and drop keys that no longer exist.
  return chunks.flatMap((keys, i) =>
    keys.map((key) => fetched[i].get(key)).filter((m): m is Mapping => m != null),
  );
}

export async function getAllMappings(kv: KVNamespace): Promise<Mapping[]> {
  const keys: KVNamespaceListKey<unknown, string>[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({ prefix: SLUG_PREFIX, cursor });
    keys.push(...result.keys);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  if (keys.length === 0) return [];
  return getMappingsBySlugs(kv, keys.map((k) => k.name.slice(SLUG_PREFIX.length)));
}
