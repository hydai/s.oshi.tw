const RESERVED_SLUGS = new Set(['new', 'admin']);

// KV rejects keys longer than 512 bytes; 'slug:' eats 5 of them.
const MAX_SLUG_BYTES = 512 - 'slug:'.length;

const SLUG_MIN = 2;
const SLUG_MAX = 30;

// Latin letters, digits and the CJK scripts this community actually uses: Han
// for Chinese, Hiragana/Katakana for Japanese names, plus the prolonged sound
// mark ー, which Unicode classifies as Common rather than Katakana. Everything
// else is refused, which is what stops Cyrillic 'оshi' impersonating 'oshi' in
// a listing the admin approves by eye.
const SLUG_CHAR = '[a-z0-9\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー]';
const SLUG_RE = new RegExp(`^${SLUG_CHAR}+(?:-${SLUG_CHAR}+)*$`, 'u');

/**
 * Cheap pre-filter for the redirect catch-all. Deliberately far more
 * permissive than validateSlug: lookups must keep working for every slug
 * ever stored, even if the submission rules are tightened later. It only
 * rejects paths that cannot be a slug at all, so bot probes and
 * favicon.ico never reach KV and over-long keys never make KV throw.
 */
export function couldBeSlug(slug: string): boolean {
  if (!slug) return false;
  if (/[.\\/\s]/.test(slug)) return false;
  return new TextEncoder().encode(slug).length <= MAX_SLUG_BYTES;
}

/**
 * The single normalization step. NFKC folds full-width ｏｓｈｉ onto oshi and
 * decomposed forms onto composed ones; lowercasing makes /MyLink and /mylink
 * the same link and keeps 'Admin' from slipping past RESERVED_SLUGS. Must be
 * applied identically when storing a slug and when looking one up.
 */
export function canonicalSlug(raw: string): string {
  return raw.normalize('NFKC').toLowerCase();
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

/** Validates an already-canonical slug; non-canonical input is rejected. */
export function validateSlug(slug: string): boolean {
  if (canonicalSlug(slug) !== slug) return false;
  // Count characters, not UTF-16 units, so '𠮷' is one character and a 16-char
  // Extension-B name is not measured as 32.
  const length = Array.from(slug).length;
  if (length < SLUG_MIN || length > SLUG_MAX) return false;
  // Invisible characters would render as a blank link in the listing.
  if (/\p{Default_Ignorable_Code_Point}/u.test(slug)) return false;
  if (!SLUG_RE.test(slug)) return false;
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
  const slug = canonicalSlug((body.slug ?? '').trim());
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
    errors.push({ field: 'slug', message: '短網址格式不正確（2-30 字元，可用英數字、中日文字與連字號）' });
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
