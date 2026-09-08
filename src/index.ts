import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import type { Bindings, Mapping } from './types';
import { getMapping, putMapping, slugExists, generateSlug, getListedIndex, addToListedIndex, removeFromListedIndex, getMappingsBySlugs, getAllMappings } from './kv';
import { validateSubmission } from './validate';
import { requireAdmin } from './auth';
import { renderListingPage } from './pages/listing';
import { renderSubmitForm, renderConfirmation } from './pages/form';
import { renderAdminDashboard } from './pages/admin';
import { renderNotFound } from './pages/not-found';

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
  const body = await c.req.parseBody() as Record<string, string>;
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

  return c.redirect(`/new?submitted=${slug}`, 302);
});

// --- Admin routes ---

// CSRF: hono/csrf guards form-style content types (incl. text/plain), which are
// the only bodies a cross-site form can send. The dashboard's same-origin JSON
// fetch is not a form content type and passes through untouched.
app.use('/admin/*', csrf());
app.use('/admin/*', requireAdmin);
app.use('/admin', requireAdmin);

app.get('/admin', async (c) => {
  const mappings = await getAllMappings(c.env.OSHI_SHORT_URLS);
  const adminEmail = c.get('adminEmail');
  return c.html(renderAdminDashboard(mappings, adminEmail));
});

// Admin API — status transitions
const TRANSITIONS: Record<string, { from: string; to: string; setApproved: boolean }> = {
  approve: { from: 'pending', to: 'approved', setApproved: true },
  reject: { from: 'pending', to: 'rejected', setApproved: false },
  disable: { from: 'approved', to: 'disabled', setApproved: false },
  enable: { from: 'disabled', to: 'approved', setApproved: true },
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
  const slug = c.req.param('slug');
  const mapping = await getMapping(c.env.OSHI_SHORT_URLS, slug);

  if (!mapping || mapping.status !== 'approved') {
    return c.html(renderNotFound(), 404);
  }

  c.header('Cache-Control', 'no-store');
  return c.redirect(mapping.url, 302);
});

export default app;
