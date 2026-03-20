import { Hono } from 'hono';
import type { Bindings } from './types';
import { getMapping } from './kv';
import { renderNotFound } from './pages/not-found';

const app = new Hono<{ Bindings: Bindings; Variables: { adminEmail: string } }>();

// --- Public routes (defined before /:slug catch-all) ---

app.get('/', (c) => {
  return c.text('TODO: listing page');
});

app.get('/new', (c) => {
  return c.text('TODO: submission form');
});

app.post('/new', (c) => {
  return c.text('TODO: process submission');
});

// --- Admin routes (stub) ---

app.get('/admin', (c) => {
  return c.text('TODO: admin dashboard');
});

// --- Redirect catch-all (must be last) ---

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const mapping = await getMapping(c.env.SHORT_URLS, slug);

  if (!mapping || mapping.status !== 'approved') {
    return c.html(renderNotFound(), 404);
  }

  return c.redirect(mapping.url, 302);
});

export default app;
