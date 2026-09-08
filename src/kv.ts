import type { Mapping, MappingStatus } from './types';

const SLUG_PREFIX = 'slug:';
// KV refuses keys over 512 bytes by throwing. A slug that long cannot name a
// stored record, so every read here treats it as a miss instead of letting the
// error reach the caller. Owning the rule beside the key format means no call
// site has to remember it.
const MAX_KEY_BYTES = 512;
const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 6;
const MAX_RETRIES = 5;

// A bulk get accepts up to 100 keys and counts as a single KV operation, so
// chunking keeps both list pages far below the per-invocation operation cap
// that one read per record would otherwise walk into.
const BULK_GET_LIMIT = 100;

const STATUSES = new Set<string>(['pending', 'approved', 'disabled', 'rejected']);

function keyFor(slug: string): string | null {
  const key = `${SLUG_PREFIX}${slug}`;
  return new TextEncoder().encode(key).length > MAX_KEY_BYTES ? null : key;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Turns a stored value into a Mapping, or null if it cannot be trusted.
 *
 * Reads used to ask KV for 'json', which parses inside the bulk call, so a
 * single unparseable record threw and took the whole listing or dashboard with
 * it. Parsing per record contains the damage to that record. Fields the rest of
 * the app relies on are required; the display-only ones are filled in, so a
 * record missing an optional field still shows rather than disappearing.
 */
function toMapping(raw: string | null, key: string): Mapping | null {
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.error('Skipping unparseable record', { key });
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    console.error('Skipping record that is not an object', { key });
    return null;
  }

  const m = value as Record<string, unknown>;
  const ok =
    typeof m.slug === 'string' &&
    typeof m.url === 'string' &&
    typeof m.title === 'string' &&
    typeof m.listed === 'boolean' &&
    typeof m.status === 'string' &&
    STATUSES.has(m.status) &&
    typeof m.createdAt === 'string' &&
    typeof m.updatedAt === 'string' &&
    (m.approvedAt === null || typeof m.approvedAt === 'string');

  if (!ok) {
    console.error('Skipping record with unexpected shape', { key, status: m.status });
    return null;
  }

  return {
    slug: m.slug as string,
    url: m.url as string,
    title: m.title as string,
    description: asText(m.description),
    photo: asText(m.photo),
    author: asText(m.author),
    contact: asText(m.contact),
    notes: asText(m.notes),
    listed: m.listed as boolean,
    status: m.status as MappingStatus,
    createdAt: m.createdAt as string,
    updatedAt: m.updatedAt as string,
    approvedAt: (m.approvedAt ?? null) as string | null,
  };
}

export async function getMapping(kv: KVNamespace, slug: string): Promise<Mapping | null> {
  const key = keyFor(slug);
  if (key === null) return null;
  return toMapping(await kv.get(key, 'text'), key);
}

export async function putMapping(kv: KVNamespace, mapping: Mapping): Promise<void> {
  await kv.put(`${SLUG_PREFIX}${mapping.slug}`, JSON.stringify(mapping));
}

export async function slugExists(kv: KVNamespace, slug: string): Promise<boolean> {
  const key = keyFor(slug);
  if (key === null) return false;
  return (await kv.get(key)) !== null;
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

export async function getMappingsBySlugs(kv: KVNamespace, slugs: string[]): Promise<Mapping[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < slugs.length; i += BULK_GET_LIMIT) {
    chunks.push(slugs.slice(i, i + BULK_GET_LIMIT).map((s) => `${SLUG_PREFIX}${s}`));
  }

  const fetched = await Promise.all(chunks.map((keys) => kv.get(keys, 'text')));

  // Preserve the caller's slug order, and drop keys that are absent or that
  // hold something this app cannot read.
  return chunks.flatMap((keys, i) =>
    keys
      .map((key) => toMapping(fetched[i].get(key) ?? null, key))
      .filter((m): m is Mapping => m !== null),
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
