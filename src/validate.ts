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

// The CJK Radicals Supplement is Script=Han and, unlike the Kangxi Radicals,
// NFKC leaves it alone. Its stable characters draw the same glyphs as ordinary
// ideographs, so ⻤滅之刃 and 鬼滅之刃 would be two keys the admin cannot tell
// apart on the dashboard. Refusing the block closes the same-script homograph
// the allowlist above is meant to prevent.
const CJK_RADICALS_SUPPLEMENT = /[\u2E80-\u2EFF]/u;

// ー earns its place inside Japanese words such as ラーメン, but alone it reads
// as a dash and walks straight past the hyphen structure rules: ーoshi, osーーhi
// and even a slug of nothing but ーー. Require the kana that give it a reason
// to be there.
const PROLONGED_SOUND_MARK = /ー/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Cheap pre-filter for the redirect catch-all, applied to the canonical form.
 * Deliberately far looser than validateSlug so that tightening the submission
 * rules does not retire a slug that is already live; note that canonicalization
 * itself still has to be matched by whatever is stored. It rejects only paths
 * that cannot be a slug at all, so bot probes and favicon.ico never reach KV
 * and an over-long key never makes KV throw.
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

/**
 * Characters as a reader counts them, not UTF-16 units. Without this a title
 * of 51 emoji measures 102 and is refused, while 50 astral ideographs measure
 * 100 and pass, so the effective limit would swing with the plane.
 */
function charCount(text: string): number {
  return Array.from(text).length;
}

// Every other field is capped; these two were not, so one anonymous request
// could store a value of any size and print it into both the dashboard and the
// public listing. 2048 is the length browsers and proxies have long treated as
// the practical ceiling for a URL.
const MAX_URL_LENGTH = 2048;

/** Validates an already-canonical slug; non-canonical input is rejected. */
export function validateSlug(slug: string): boolean {
  if (canonicalSlug(slug) !== slug) return false;
  // Count characters, not UTF-16 units, so '𠮷' is one character and a 16-char
  // Extension-B name is not measured as 32.
  const length = charCount(slug);
  if (length < SLUG_MIN || length > SLUG_MAX) return false;
  // Invisible characters would render as a blank link in the listing.
  if (/\p{Default_Ignorable_Code_Point}/u.test(slug)) return false;
  if (CJK_RADICALS_SUPPLEMENT.test(slug)) return false;
  if (PROLONGED_SOUND_MARK.test(slug) && !KANA.test(slug)) return false;
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
  } else if (charCount(url) > MAX_URL_LENGTH) {
    errors.push({ field: 'url', message: `目標網址不可超過 ${MAX_URL_LENGTH} 字` });
  } else if (!validateUrl(url)) {
    errors.push({ field: 'url', message: '請輸入有效的 HTTP/HTTPS 網址' });
  }

  if (!title) {
    errors.push({ field: 'title', message: '請輸入標題' });
  } else if (charCount(title) > 100) {
    errors.push({ field: 'title', message: '標題不可超過 100 字' });
  }

  if (slug && !validateSlug(slug)) {
    errors.push({ field: 'slug', message: '短網址格式不正確（2-30 字元，可用英數字、中日文字與連字號）' });
  }

  if (charCount(description) > 200) {
    errors.push({ field: 'description', message: '描述不可超過 200 字' });
  }

  if (photo && charCount(photo) > MAX_URL_LENGTH) {
    errors.push({ field: 'photo', message: `圖片網址不可超過 ${MAX_URL_LENGTH} 字` });
  } else if (photo && !validateUrl(photo)) {
    errors.push({ field: 'photo', message: '圖片網址格式不正確' });
  }

  if (charCount(author) > 50) {
    errors.push({ field: 'author', message: '作者名稱不可超過 50 字' });
  }

  if (charCount(contact) > 100) {
    errors.push({ field: 'contact', message: '聯絡方式不可超過 100 字' });
  }

  if (charCount(notes) > 500) {
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
