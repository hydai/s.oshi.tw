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

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * First user-perceived character. Code points are not enough: a flag is two
 * regional indicators, a family emoji is several joined by U+200D, and a
 * skin-tone emoji carries a modifier, so slicing any of them shows a fragment.
 */
export function firstGrapheme(text: string): string {
  for (const { segment } of GRAPHEMES.segment(text)) return segment;
  return '';
}
