import type { Context, Next } from 'hono';
import type { Bindings } from './types';

type Env = { Bindings: Bindings; Variables: { adminEmail: string } };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * DEV_AUTH_EMAIL exists so `wrangler dev` can reach /admin without Access in
 * front of it. Set as a production variable it would make every anonymous
 * request an admin, so honour it only on a local hostname.
 */
function devAuthEmail(c: Context<Env>): string | undefined {
  if (!c.env.DEV_AUTH_EMAIL) return undefined;
  if (LOCAL_HOSTS.has(new URL(c.req.url).hostname)) return c.env.DEV_AUTH_EMAIL;
  console.warn('DEV_AUTH_EMAIL is set but ignored outside local development');
  return undefined;
}

export async function requireAdmin(c: Context<Env>, next: Next) {
  const email = c.req.header('CF-Access-Authenticated-User-Email') || devAuthEmail(c);
  if (!email) {
    return c.json({ error: 'Unauthorized: missing CF Access header' }, 401);
  }

  const allowed = c.env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email.toLowerCase())) {
    return c.json({ error: 'Forbidden: admin access required' }, 403);
  }

  c.set('adminEmail', email);
  await next();
}
