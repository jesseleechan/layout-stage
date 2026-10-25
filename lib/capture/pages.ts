/* A site's pages, for capturing a whole template at once. The capture browser reads the start page's
   menu links and the site's sitemap (lib/capture/server.ts, findSitePages); this turns them into a
   short list: the start page, then the menu in its order, then the sitemap, shallow pages first. Same
   site only, no shop/account/search/archive pages, no files, each page once. Pure. */

export interface PageLink {
  href: string;
  text: string;
}

/** What the browser read from the site. */
export interface SiteScan {
  /** Where the start page ended up after redirects. */
  finalUrl: string;
  /** Links in the page's header and navigation, in order. */
  nav: PageLink[];
  /** Every link on the page, in order (used when the menu and sitemap give little). */
  links: PageLink[];
  /** Page addresses from the sitemap, in its order. */
  sitemap: string[];
}

export interface SitePage {
  url: string;
  title: string;
  /** In the site's menu (or the start page): ticked to begin with. */
  nav: boolean;
}

/** Most pages listed. */
export const MAX_SITE_PAGES = 40;
/** Pages ticked to begin with. */
export const SITE_PICK_DEFAULT = 6;
/** Fewer menu and sitemap pages than this and the page's other links are listed too. */
const FEW = 3;

const SKIP_PATH =
  /\/(cart|checkout|account|accounts|login|log-in|signin|sign-in|signup|sign-up|register|search|wp-admin|wp-login\.php|feed|rss|tag|tags|category|categories|author|cdn-cgi|s\/|page\/\d+)(\/|$)/i;
const FILE = /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|mp3|mp4|mov|webm|xml|txt|json|css|js|woff2?)$/i;

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

/** A page's address without its query, fragment or trailing slash (the root keeps its slash). */
export function pageUrl(raw: string, base: URL): URL | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (host(u) !== host(base)) return null;
  u.hash = '';
  u.search = '';
  u.username = '';
  u.password = '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  if (SKIP_PATH.test(u.pathname + '/') || FILE.test(u.pathname)) return null;
  return u;
}

const key = (u: URL) => `${host(u)}${decodeURI(u.pathname).toLowerCase()}`;

/** "about-us" → "About us"; the root is "Home". */
export function titleFromPath(pathname: string): string {
  const last = decodeURIComponent(pathname.replace(/\/+$/, '').split('/').pop() || '');
  if (!last) return 'Home';
  const words = last.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Home';
}

const cleanText = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 60);
const depth = (u: URL) => u.pathname.split('/').filter(Boolean).length;

/** The pages to offer, in order (see the top of this file). */
export function sitePages(scan: SiteScan): SitePage[] {
  let base: URL;
  try {
    base = new URL(scan.finalUrl);
  } catch {
    return [];
  }
  const out: SitePage[] = [];
  const seen = new Set<string>();
  const add = (raw: string, text: string, nav: boolean) => {
    if (out.length >= MAX_SITE_PAGES) return;
    const u = pageUrl(raw, base);
    if (!u || seen.has(key(u))) return;
    seen.add(key(u));
    const t = cleanText(text);
    out.push({ url: u.href, title: t && t.length > 1 ? t : titleFromPath(u.pathname), nav });
  };
  add(base.href, depth(base) ? '' : 'Home', true);
  for (const l of scan.nav) add(l.href, l.text, true);
  const fromMap = scan.sitemap
    .map((s, i) => ({ s, i, u: pageUrl(s, base) }))
    .filter((x): x is { s: string; i: number; u: URL } => !!x.u)
    .sort((a, b) => depth(a.u) - depth(b.u) || a.i - b.i);
  for (const x of fromMap) add(x.s, '', false);
  if (out.length < FEW) for (const l of scan.links) add(l.href, l.text, false);
  return out;
}

/** The sitemap's page addresses, or the child sitemaps of a sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = Array.from(xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi), (m) =>
    m[1].replace(/&amp;/g, '&'),
  );
  return /<sitemapindex[\s>]/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Which child sitemaps of an index to read: page sitemaps first (WordPress, Shopify), at most `n`. */
export function childSitemaps(list: string[], n = 3): string[] {
  const score = (s: string) => (/page/i.test(s) ? 0 : /post|product|collection|blog/i.test(s) ? 2 : 1);
  return [...list].sort((a, b) => score(a) - score(b)).slice(0, n);
}

/** The pages ticked to begin with: the start page and the menu, at most SITE_PICK_DEFAULT. */
export function defaultPicks(pages: SitePage[]): string[] {
  const nav = pages.filter((p) => p.nav);
  return (nav.length ? nav : pages).slice(0, SITE_PICK_DEFAULT).map((p) => p.url);
}
