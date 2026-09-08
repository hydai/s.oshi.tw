/**
 * Timestamps are stored as UTC ISO strings but read by an admin in Taiwan.
 * workerd ships full ICU, so the platform formatter handles the zone; sv-SE
 * is used because its locale format is already YYYY-MM-DD HH:mm.
 */
const TAIPEI = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatTaipei(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : TAIPEI.format(ms);
}
