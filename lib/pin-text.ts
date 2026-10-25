/* Pin text: a title, description, alt text and destination link to paste into Pinterest (or under an
   Etsy listing's pin), suggested from what the canvas knows (site names, the canvas type, how many
   layouts, the headline and badge, captured URLs). A field the user edits is kept with the canvas in
   `doc.pin`; a field never edited (or reset) follows the suggestion as the canvas changes. Pure. */
import type { Composition, PresetId, Slot } from './model';

export type PinField = 'title' | 'description' | 'alt' | 'link';
/** Edited fields only; a missing field shows its suggestion. */
export type PinText = Partial<Record<PinField, string>>;
export type PinValues = Record<PinField, string>;

export const PIN_FIELDS: PinField[] = ['title', 'description', 'alt', 'link'];
/** Pinterest's limits (title 100, description 500, alt text 500); links get a generous cap. */
export const PIN_LIMITS: Record<PinField, number> = { title: 100, description: 500, alt: 500, link: 2048 };
export const PIN_LABELS: Record<PinField, string> = { title: 'Title', description: 'Description', alt: 'Alt text', link: 'Destination link' };

/* ---------------- what the canvas knows ---------------- */

/** File names that say nothing about the site (screenshots, pasted images, camera names). */
const NOISE_NAME = /^(screen ?shot|screenshot|cleanshot|capture|scr|img|image|pasted image|untitled|photo|download|unnamed|shot)\b|^(img|dsc|pxl)[_-]?\d|^[\d\s_.-]+$/i;

/** Hostname without www., or null. */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^www\./i, '');
    return h || null;
  } catch {
    return null;
  }
}

/** The site's name for a layout: the hostname of a capture, a sample's name, or a file name that
 *  reads like one ("juniper-home.png" → "juniper home"). Null when the name says nothing. */
export function siteName(s: Pick<Slot, 'name' | 'source'>): string | null {
  if (s.source.kind === 'url') return hostOf(s.source.url) ?? (s.name.trim() || null);
  if (s.source.kind === 'sample') return s.name.trim() || null;
  const base = s.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  if (!base || NOISE_NAME.test(base)) return null;
  const clean = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length >= 2 ? clean.slice(0, 40).trim() : null;
}

/** Distinct site names of the visible layouts, in layout order. */
export function siteNames(doc: Pick<Composition, 'slots' | 'count'>): string[] {
  const out: string[] = [];
  for (const s of doc.slots.slice(0, doc.count)) {
    const n = siteName(s);
    if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The first captured URL among the visible layouts, or ''. */
export function firstCaptureUrl(doc: Pick<Composition, 'slots' | 'count'>): string {
  for (const s of doc.slots.slice(0, doc.count)) if (s.source.kind === 'url' && s.source.url) return s.source.url;
  return '';
}

const isEtsy = (p: PresetId) => p === 'etsy43' || p === 'etsy11';

/** "on desktop and mobile" when one site is shown at desktop and at phone width (captures). */
function devicesPhrase(doc: Pick<Composition, 'slots' | 'count'>): string {
  const widths = doc.slots.slice(0, doc.count).map((s) => (s.source.kind === 'url' ? s.source.options.width : null));
  return widths.includes(390) && widths.some((w) => w != null && w >= 1280) ? ' on desktop and mobile' : '';
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

/* ---------------- templates ---------------- */

/** Cuts text to max characters at a word boundary, with an ellipsis. */
export function trimTo(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[\s,;:.!?—–-]+$/, '') + '…';
}

/** Suggested text for every field. */
export function suggestPinText(doc: Pick<Composition, 'preset' | 'slots' | 'count' | 'overlays' | 'background'>): PinValues {
  const names = siteNames(doc);
  const n = doc.count;
  const etsy = isEtsy(doc.preset);
  const noun = etsy ? 'website template' : 'website design';
  const devices = devicesPhrase(doc);
  const link = firstCaptureUrl(doc);
  const host = link ? hostOf(link) : null;
  const o = doc.overlays;
  const headline = o?.headline.enabled ? oneLine(o.headline.text) : '';
  const badge = o?.badge.enabled ? oneLine(o.badge.text) : '';
  const sites = joinNames(names);
  const one = names.length === 1;

  // Title: the headline when there is one, else the sites.
  let title = headline;
  if (!title && names.length) title = etsy ? `${sites} ${noun}${one ? '' : 's'}` : `${sites} — ${noun}${one ? '' : 's'}${devices}`;
  if (!title) title = etsy ? 'Website template' : n > 1 ? `${n} website designs` : 'Website design inspiration';

  // Description: what it shows, where to see it, and what to do next.
  let what: string;
  if (one) what = n > 1 && !devices ? `${n} views of the ${names[0]} ${noun}.` : `The ${names[0]} ${noun}${devices}.`;
  else if (names.length) what = `${names.length} ${noun}s: ${sites}.`;
  else what = n > 1 ? `${n} ${noun}s.` : `A ${noun}.`;
  const lead = headline ? `${headline.replace(/[.!?…]*$/, '')}. ` : '';
  const visit = host ? (one ? ` See it live at ${host}.` : ` See ${host} live.`) : '';
  const next = etsy ? 'See the full listing on Etsy for every page and what’s included.' : 'Save this pin for your next web design project.';
  const description = `${lead}${what}${visit} ${next}`;

  // Alt text: what the image looks like, including any text on it.
  const kind = etsy ? 'Etsy listing photo' : doc.preset === 'pin' ? 'Pinterest pin' : 'Image';
  let shots: string;
  if (one) shots = `${n > 1 ? 'screenshots' : 'a screenshot'} of the ${names[0]} website${devices}`;
  else if (names.length) shots = `screenshots of ${names.length} websites (${sites})`;
  else shots = n > 1 ? `${n} website screenshots` : 'a website screenshot';
  const frames = n > 1 ? 'in frames' : 'in a frame';
  const bg = { solid: 'a plain', gradient: 'a gradient', mesh: 'a soft color', image: 'a photo' }[doc.background.type] ?? 'a';
  const extras = [headline && `the headline “${headline}”`, badge && `a “${badge}” badge`].filter(Boolean);
  const alt = `${kind} showing ${shots} ${frames} on ${bg} background${extras.length ? `, with ${extras.join(' and ')}` : ''}.`;

  return {
    title: trimTo(title, PIN_LIMITS.title),
    description: trimTo(description, PIN_LIMITS.description),
    alt: trimTo(alt, PIN_LIMITS.alt),
    link: link.slice(0, PIN_LIMITS.link),
  };
}

/** What each field shows: the user's text where edited, else the suggestion. */
export function pinTextOf(doc: Pick<Composition, 'preset' | 'slots' | 'count' | 'overlays' | 'background' | 'pin'>): { values: PinValues; suggested: PinValues; edited: Record<PinField, boolean> } {
  const suggested = suggestPinText(doc);
  const pin = doc.pin ?? {};
  const edited = { title: pin.title != null, description: pin.description != null, alt: pin.alt != null, link: pin.link != null };
  const values = { ...suggested };
  for (const f of PIN_FIELDS) if (pin[f] != null) values[f] = pin[f]!;
  return { values, suggested, edited };
}

/** All four fields, labelled, for one paste. Empty fields are left out. */
export function copyAllText(v: PinValues): string {
  return PIN_FIELDS.filter((f) => v[f].trim())
    .map((f) => `${PIN_LABELS[f]}: ${v[f].trim()}`)
    .join('\n\n');
}

/** Edited fields from a save; undefined when there are none (older saves have no `pin`). */
export function sanitizePinText(raw: unknown): PinText | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: PinText = {};
  for (const f of PIN_FIELDS) if (typeof r[f] === 'string') out[f] = (r[f] as string).slice(0, PIN_LIMITS[f]);
  return Object.keys(out).length ? out : undefined;
}
