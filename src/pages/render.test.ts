import { describe, expect, it } from 'vitest';
import { renderAdminDashboard } from './admin';
import { formatTaipei } from '../format';
import { renderListingPage } from './listing';
import { renderConfirmation, renderSubmitForm } from './form';
import { mapping } from '../test-support';

const render = async (node: unknown) => String(await node);

describe('formatTaipei', () => {
  it.each([
    ['2026-09-08T02:05:00.000Z', '2026-09-08 10:05'],
    ['2026-01-15T03:00:00.000Z', '2026-01-15 11:00'],
    ['2026-09-07T16:30:00.000Z', '2026-09-08 00:30'],
    ['2026-12-31T20:00:00.000Z', '2027-01-01 04:00'],
  ])('renders %j as %j', (iso, expected) => {
    expect(formatTaipei(iso)).toBe(expected);
  });

  it('passes an unparseable value through unchanged', () => {
    expect(formatTaipei('not a date')).toBe('not a date');
  });
});

describe('admin dashboard', () => {
  // Approving a listed card publishes its image to every visitor, so the
  // reviewer has to be able to see the URL and its host before deciding.
  it('shows the submitted photo URL', async () => {
    const html = await render(
      renderAdminDashboard([mapping({ photo: 'https://img.example/pic.jpg' })], 'admin@example.com'),
    );
    expect(html).toContain('https://img.example/pic.jpg');
    expect(html).toContain('顯示圖片預覽');
  });

  // The URL is attacker-controlled, so rendering it as an image on page load
  // would make the reviewer's browser call that host on every dashboard visit.
  it('does not fetch the photo until the reviewer asks for it', async () => {
    const html = await render(
      renderAdminDashboard([mapping({ photo: 'https://attacker.example/beacon.png' })], 'admin@example.com'),
    );
    expect(html).not.toMatch(/<img[^>]*src=/);
    expect(html).toContain('data-photo="https://attacker.example/beacon.png"');
  });

  it('renders nothing photo-related when no photo was submitted', async () => {
    const html = await render(renderAdminDashboard([mapping({})], 'admin@example.com'));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data-photo');
    expect(html).not.toContain('顯示圖片預覽');
  });

  it('escapes a photo URL that tries to break out of the attribute', async () => {
    const html = await render(
      renderAdminDashboard([mapping({ photo: 'https://x/a.jpg" onerror="alert(1)' })], 'a@e.com'),
    );
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it('shows timestamps in Taipei time and says so', async () => {
    const html = await render(
      renderAdminDashboard(
        [mapping({ createdAt: '2026-09-08T02:05:00.000Z', approvedAt: '2026-09-08T03:00:00.000Z', status: 'approved' })],
        'admin@example.com',
      ),
    );
    expect(html).toContain('2026-09-08 10:05');
    expect(html).toContain('2026-09-08 11:00');
    expect(html).toContain('UTC+8');
    expect(html).not.toContain('2026-09-08 02:05');
  });

  it('offers only the actions each status allows', async () => {
    const actions = async (status: 'pending' | 'approved' | 'disabled' | 'rejected') => {
      const html = await render(renderAdminDashboard([mapping({ status })], 'a@e.com'));
      return ['approve', 'reject', 'disable', 'enable'].filter((a) =>
        html.includes(`adminAction('${a}'`),
      );
    };
    expect(await actions('pending')).toEqual(['approve', 'reject']);
    expect(await actions('approved')).toEqual(['disable']);
    expect(await actions('disabled')).toEqual(['enable']);
    expect(await actions('rejected')).toEqual([]);
  });

  it('keeps private fields visible to the admin', async () => {
    const html = await render(
      renderAdminDashboard([mapping({ contact: 'me@example.com', notes: 'please approve' })], 'a@e.com'),
    );
    expect(html).toContain('me@example.com');
    expect(html).toContain('please approve');
  });
});

describe('listing page', () => {
  // A code point is not a character: a flag is two regional indicators, a
  // family emoji several joined by U+200D, a skin tone an emoji plus modifier.
  it.each([
    ['🎀リボン', '🎀'],
    ['𠀀字', '𠀀'],
    ['子午計畫', '子'],
    ['Example', 'E'],
    ['🇹🇼 台灣官方', '🇹🇼'],
    ['👨‍👩‍👧 家族', '👨‍👩‍👧'],
    ['👍🏽 讚', '👍🏽'],
  ])('shows %j as the whole grapheme %j in the avatar', async (title, initial) => {
    const html = await render(renderListingPage([mapping({ title, status: 'approved', listed: true })]));
    expect(html).toContain(`>${initial}<`);
    expect(html).not.toContain('�');
  });

  it('hardens the submitter-supplied image every visitor loads', async () => {
    const html = await render(
      renderListingPage([mapping({ status: 'approved', listed: true, photo: 'https://tracker.example/p.png' })]),
    );
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it('names CJK faces in the font stack, since the interface is Chinese', async () => {
    const html = await render(renderListingPage([]));
    expect(html).toContain('PingFang TC');
    expect(html).toContain('Noto Sans TC');
  });

  it('never exposes contact details or admin notes', async () => {
    const html = await render(
      renderListingPage([
        mapping({ status: 'approved', listed: true, contact: 'secret@example.com', notes: 'internal note' }),
      ]),
    );
    expect(html).not.toContain('secret@example.com');
    expect(html).not.toContain('internal note');
  });

  it('escapes a title that contains markup', async () => {
    const html = await render(
      renderListingPage([mapping({ status: 'approved', listed: true, title: '<script>alert(1)</script>' })]),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('submission form', () => {
  it('preserves submitted values and shows field errors', async () => {
    const html = await render(
      renderSubmitForm([{ field: 'slug', message: '短網址格式不正確' }], { url: 'https://kept.example', slug: 'bad slug' }),
    );
    expect(html).toContain('https://kept.example');
    expect(html).toContain('短網址格式不正確');
  });

  it('describes the slug rule the validator actually enforces', async () => {
    const html = await render(renderSubmitForm());
    expect(html).toContain('中日文字');
    expect(html).toContain('小寫');
  });

  it('shows the slug on the confirmation page', async () => {
    const html = await render(renderConfirmation('子午計畫'));
    expect(html).toContain('s.oshi.tw/子午計畫');
    expect(html).toContain('待審核');
  });
});
