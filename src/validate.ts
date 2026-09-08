const RESERVED_SLUGS = new Set(['new', 'admin']);

// KV rejects keys longer than 512 bytes; 'slug:' eats 5 of them.
const MAX_SLUG_BYTES = 512 - 'slug:'.length;

/**
 * Cheap pre-filter for the redirect catch-all. Deliberately far more
 * permissive than validateSlug: lookups must keep working for every slug
 * ever stored, even if the submission rules are tightened later. It only
 * rejects paths that cannot be a slug at all, so bot probes and
 * favicon.ico never reach KV and over-long keys never make KV throw.
 */
export function couldBeSlug(slug: string): boolean {
  if (!slug) return false;
  if (/[.\\\/\s]/.test(slug)) return false;
  return new TextEncoder().encode(slug).length <= MAX_SLUG_BYTES;
}

export function validateUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function validateSlug(slug: string): boolean {
  if (slug.length < 2 || slug.length > 30) return false;
  if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}

interface FieldError {
  field: string;
  message: string;
}

type ValidationResult =
  | { ok: true; data: ValidatedSubmission }
  | { ok: false; errors: FieldError[] };

export interface ValidatedSubmission {
  url: string;
  title: string;
  slug: string;
  description: string;
  photo: string;
  author: string;
  contact: string;
  notes: string;
  listed: boolean;
}

export function validateSubmission(body: Record<string, string>): ValidationResult {
  const errors: FieldError[] = [];

  const url = (body.url ?? '').trim();
  const title = (body.title ?? '').trim();
  const slug = (body.slug ?? '').trim();
  const description = (body.description ?? '').trim();
  const photo = (body.photo ?? '').trim();
  const author = (body.author ?? '').trim();
  const contact = (body.contact ?? '').trim();
  const notes = (body.notes ?? '').trim();
  const listed = body.listed === 'on';

  if (!url) {
    errors.push({ field: 'url', message: '請輸入目標網址' });
  } else if (!validateUrl(url)) {
    errors.push({ field: 'url', message: '請輸入有效的 HTTP/HTTPS 網址' });
  }

  if (!title) {
    errors.push({ field: 'title', message: '請輸入標題' });
  } else if (title.length > 100) {
    errors.push({ field: 'title', message: '標題不可超過 100 字' });
  }

  if (slug && !validateSlug(slug)) {
    errors.push({ field: 'slug', message: '短網址格式不正確（2-30 字元，中英文、數字與連字號）' });
  }

  if (description.length > 200) {
    errors.push({ field: 'description', message: '描述不可超過 200 字' });
  }

  if (photo && !validateUrl(photo)) {
    errors.push({ field: 'photo', message: '圖片網址格式不正確' });
  }

  if (author.length > 50) {
    errors.push({ field: 'author', message: '作者名稱不可超過 50 字' });
  }

  if (contact.length > 100) {
    errors.push({ field: 'contact', message: '聯絡方式不可超過 100 字' });
  }

  if (notes.length > 500) {
    errors.push({ field: 'notes', message: '備註不可超過 500 字' });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      url: validateUrl(url)!,
      title,
      slug,
      description,
      photo: photo ? validateUrl(photo)! : '',
      author,
      contact,
      notes,
      listed,
    },
  };
}
