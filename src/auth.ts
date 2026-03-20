import type { Context, Next } from 'hono';
import type { Bindings } from './types';

type Env = { Bindings: Bindings; Variables: { adminEmail: string } };

export async function requireAdmin(c: Context<Env>, next: Next) {
  const email =
    c.req.header('CF-Access-Authenticated-User-Email') || c.env.DEV_AUTH_EMAIL;
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
