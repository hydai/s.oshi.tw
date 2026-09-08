import type { Mapping, MappingStatus } from './types';

export const NOW = '2026-09-08T02:05:00.000Z';

export function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    slug: 'demo',
    url: 'https://example.com/target',
    title: 'Demo',
    description: '',
    photo: '',
    author: '',
    contact: '',
    notes: '',
    listed: false,
    status: 'pending' as MappingStatus,
    createdAt: NOW,
    updatedAt: NOW,
    approvedAt: null,
    ...over,
  };
}

// The limits real KV enforces by throwing. Modelling them here is what lets
// the guards against them be tested at all.
const MAX_KEY_BYTES = 512;
const MAX_BULK_KEYS = 100;
const MAX_VALUE_BYTES = 25 * 1024 * 1024;

function checkKey(key: string): void {
  const bytes = new TextEncoder().encode(key).length;
  if (bytes > MAX_KEY_BYTES) {
    throw new Error(
      `KV GET failed: 414 UTF-8 encoded length of ${bytes} exceeds key length limit of ${MAX_KEY_BYTES}.`,
    );
  }
}

export interface FakeKV {
  kv: KVNamespace;
  store: Map<string, string>;
  /** Number of get calls; a bulk get of up to 100 keys counts as one. */
  gets: number;
  puts: number;
  lists: number;
  largestBulkGet: number;
  reset(): void;
  seed(...mappings: Mapping[]): void;
  read(slug: string): Mapping;
}

/** In-memory stand-in for KVNamespace, including the bulk-get overload. */
export function fakeKV(options: { failWith?: Error } = {}): FakeKV {
  const store = new Map<string, string>();
  const self: FakeKV = {
    store,
    gets: 0,
    puts: 0,
    lists: 0,
    largestBulkGet: 0,
    reset() {
      self.gets = 0;
      self.puts = 0;
      self.lists = 0;
      self.largestBulkGet = 0;
    },
    seed(...mappings) {
      for (const m of mappings) store.set(`slug:${m.slug}`, JSON.stringify(m));
    },
    read(slug) {
      return JSON.parse(store.get(`slug:${slug}`)!) as Mapping;
    },
    kv: {
      async get(key: string | string[], type?: string) {
        if (options.failWith) throw options.failWith;
        self.gets++;

        const read = (k: string) => {
          checkKey(k);
          const raw = store.get(k);
          if (raw === undefined) return null;
          // Real KV parses only when asked to, and a parse failure surfaces to
          // the caller. Returning parsed values regardless would hide both.
          return type === 'json' ? JSON.parse(raw) : raw;
        };

        if (Array.isArray(key)) {
          if (key.length > MAX_BULK_KEYS) {
            throw new Error(`KV GET failed: 400 too many keys (${key.length} > ${MAX_BULK_KEYS})`);
          }
          self.largestBulkGet = Math.max(self.largestBulkGet, key.length);
          return new Map(key.map((k) => [k, read(k)]));
        }
        return read(key);
      },
      async put(key: string, value: string) {
        if (options.failWith) throw options.failWith;
        checkKey(key);
        if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
          throw new Error('KV PUT failed: 413 value too large');
        }
        self.puts++;
        store.set(key, value);
      },
      async list({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) {
        if (options.failWith) throw options.failWith;
        self.lists++;
        const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + 1000);
        const done = start + page.length >= all.length;
        return {
          keys: page.map((name) => ({ name })),
          list_complete: done,
          cursor: done ? '' : String(start + page.length),
        };
      },
    } as unknown as KVNamespace,
  };
  return self;
}

export const ADMIN_EMAIL = 'admin@example.com';
export const ORIGIN = 'https://s.oshi.tw';

export function env(kv: KVNamespace, over: Record<string, unknown> = {}) {
  return { OSHI_SHORT_URLS: kv, ADMIN_EMAILS: ADMIN_EMAIL, ...over };
}

/** Headers the real admin dashboard sends: Access-authenticated, same-origin JSON. */
export function adminHeaders(over: Record<string, string> = {}) {
  return {
    'CF-Access-Authenticated-User-Email': ADMIN_EMAIL,
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    ...over,
  };
}

export function form(fields: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}
