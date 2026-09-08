import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { Bindings, Mapping } from './types';
import { getMapping, putMapping, slugExists, generateSlug, getListedIndex, addToListedIndex, removeFromListedIndex, getMappingsBySlugs, getAllMappings } from './kv';
import { validateSubmission, couldBeSlug, canonicalSlug } from './validate';
import { requireAdmin } from './auth';
import { renderListingPage } from './pages/listing';
import { renderSubmitForm, renderConfirmation } from './pages/form';
import { renderAdminDashboard } from './pages/admin';
import { renderNotFound, renderServerError } from './pages/not-found';

const app = new Hono<{ Bindings: Bindings; Variables: { adminEmail: string } }>();

// --- Public routes (defined before /:slug catch-all) ---

app.get('/', async (c) => {
  const slugs = await getListedIndex(c.env.OSHI_SHORT_URLS);
  const mappings = await getMappingsBySlugs(c.env.OSHI_SHORT_URLS, slugs);
  const listed = mappings
    .filter((m) => m.status === 'approved' && m.listed)
    .sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''));
  return c.html(renderListingPage(listed));
});

app.get('/new', (c) => {
  const submitted = c.req.query('submitted');
  if (submitted) {
    return c.html(renderConfirmation(submitted));
  }
  return c.html(renderSubmitForm());
});

app.post('/new', async (c) => {
  // parseBody yields File objects for file parts and arrays for repeated
  // fields, and throws outright on a boundary-less multipart header. The
  // validator works on strings, so coerce here and answer a malformed body
  // with the 400 the spec promises rather than a 500.
  const raw = await c.req.parseBody().catch(() => null);
  if (!raw) {
    return c.html(renderSubmitForm([], {}, '無法解析表單內容，請重新提交'), 400);
  }
  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') body[key] = value;
  }

  const result = validateSubmission(body);

  if (!result.ok) {
    return c.html(renderSubmitForm(result.errors, body), 400);
  }

  const { data } = result;

  // Determine slug
  let slug = data.slug;
  if (slug) {
    if (await slugExists(c.env.OSHI_SHORT_URLS, slug)) {
      return c.html(
        renderSubmitForm(
          [{ field: 'slug', message: '此短網址已被使用，請換一個' }],
          body,
        ),
        409,
      );
    }
  } else {
    const generated = await generateSlug(c.env.OSHI_SHORT_URLS);
    if (!generated) {
      return c.html(
        renderSubmitForm([], body, '無法自動產生短網址，請手動輸入一個'),
        409,
      );
    }
    slug = generated;
  }

  const now = new Date().toISOString();
  const mapping: Mapping = {
    slug,
    url: data.url,
    title: data.title,
    description: data.description,
    photo: data.photo,
    author: data.author,
    contact: data.contact,
    notes: data.notes,
    listed: data.listed,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
  };

  await putMapping(c.env.OSHI_SHORT_URLS, mapping);

  // Defensive: Hono only percent-encodes a Location outside the Latin-1 range.
  // The slug allowlist currently admits only ASCII and CJK, so no reachable
  // slug falls in the gap, but this keeps the header correct if the allowlist
  // is ever widened to Latin-1 letters such as e-acute.
  return c.redirect(`/new?submitted=${encodeURIComponent(slug)}`, 302);
});

// --- Admin routes ---

// CSRF: hono/csrf guards form-style content types (incl. text/plain), which are
// the only bodies a cross-site form can send. The dashboard's same-origin JSON
// fetch is not a form content type and passes through untouched.
app.use('/admin/*', csrf());
app.use('/admin/*', requireAdmin);

app.get('/admin', async (c) => {
  const mappings = await getAllMappings(c.env.OSHI_SHORT_URLS);
  const adminEmail = c.get('adminEmail');
  return c.html(renderAdminDashboard(mappings, adminEmail));
});

// Admin API — status transitions.
// setApproved stamps approvedAt, which is the public listing sort key and the
// 核准 date on the dashboard. Only the first approval sets it; re-enabling a
// disabled mapping must preserve the original date.
const TRANSITIONS: Record<string, { from: string; to: string; setApproved: boolean }> = {
  approve: { from: 'pending', to: 'approved', setApproved: true },
  reject: { from: 'pending', to: 'rejected', setApproved: false },
  disable: { from: 'approved', to: 'disabled', setApproved: false },
  enable: { from: 'disabled', to: 'approved', setApproved: false },
};

for (const [action, transition] of Object.entries(TRANSITIONS)) {
  app.post(`/admin/api/${action}`, async (c) => {
    // Parse defensively: a malformed body must not become a 500, and a
    // non-string slug would transition the mapping while pushing an
    // unremovable value into the listed index.
    const body = await c.req.json<unknown>().catch(() => null);
    const slug = (body as { slug?: unknown } | null)?.slug;
    if (typeof slug !== 'string' || !slug) {
      return c.json({ ok: false, error: 'Missing or invalid slug' }, 400);
    }

    const mapping = await getMapping(c.env.OSHI_SHORT_URLS, slug);
    if (!mapping) return c.json({ ok: false, error: 'Mapping not found' }, 404);
    if (mapping.status !== transition.from) {
      return c.json({ ok: false, error: `Cannot ${action}: status is ${mapping.status}` }, 400);
    }

    const now = new Date().toISOString();
    mapping.status = transition.to as Mapping['status'];
    mapping.updatedAt = now;
    if (transition.setApproved) mapping.approvedAt = now;

    await putMapping(c.env.OSHI_SHORT_URLS, mapping);

    // Update listed index
    if (mapping.listed) {
      if (mapping.status === 'approved') {
        await addToListedIndex(c.env.OSHI_SHORT_URLS, slug);
      } else {
        await removeFromListedIndex(c.env.OSHI_SHORT_URLS, slug);
      }
    }

    return c.json({ ok: true, slug });
  });
}

// --- Redirect catch-all (must be last) ---

app.get('/:slug', async (c) => {
  const raw = c.req.param('slug');

  // Canonicalize first: NFKC can expand a segment well past the KV key limit
  // (one Arabic ligature becomes 18 characters), so the size and shape checks
  // have to run on the key that will actually be used.
  const slug = canonicalSlug(raw);

  // Reject anything that cannot be a slug before spending a KV read, so bot
  // probes cost nothing and an over-long key returns 404 instead of throwing.
  if (!couldBeSlug(slug)) return c.notFound();
  const mapping = await getMapping(c.env.OSHI_SHORT_URLS, slug);
  if (!mapping || mapping.status !== 'approved') {
    return c.notFound();
  }

  c.header('Cache-Control', 'no-store');
  return c.redirect(mapping.url, 302);
});

// --- Fallbacks ---

app.notFound((c) =>
  c.req.path.startsWith('/admin/api/')
    ? c.json({ ok: false, error: 'Not found' }, 404)
    : c.html(renderNotFound(), 404),
);

app.onError((err, c) => {
  const isAdminApi = c.req.path.startsWith('/admin/api/');

  // Middleware signals via HTTPException. csrf() answers with a plain-text
  // "Forbidden", which the dashboard cannot read: every reply goes through
  // res.json(), so the one failure the middleware exists to produce would
  // surface as the generic 網路錯誤. Reshape it for the API prefix.
  if (err instanceof HTTPException) {
    return isAdminApi
      ? c.json({ ok: false, error: err.message || 'Forbidden' }, err.status)
      : err.getResponse();
  }

  console.error('Unhandled error', { path: c.req.path, err });
  return isAdminApi
    ? c.json({ ok: false, error: 'Internal error' }, 500)
    : c.html(renderServerError(), 500);
});

export default app;
