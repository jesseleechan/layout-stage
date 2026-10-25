/* A whole site's pages: the list made from the menu and sitemap (lib/capture/pages.ts), and reading
   them with the capture browser (findSitePages) from a local site, offline, behind the guard. A test
   policy plays DNS: public.test → the local origin, internal.test → private. */
import http from 'node:http';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { childSitemaps, defaultPicks, MAX_SITE_PAGES, parseSitemap, sitePages, titleFromPath, type SiteScan } from '@/lib/capture/pages';
import { findSitePages, shutdownCapture } from '@/lib/capture/server';
import { CaptureError } from '@/lib/capture/errors';
import type { HostPolicy } from '@/lib/capture/url-guard';

const scan = (patch: Partial<SiteScan> = {}): SiteScan => ({ finalUrl: 'https://studio.example/', nav: [], links: [], sitemap: [], ...patch });

describe('sitePages', () => {
  it('the start page, the menu in order, then the sitemap, shallow pages first', () => {
    const pages = sitePages(scan({
      nav: [
        { href: 'https://studio.example/about', text: ' About\n us ' },
        { href: '/work/', text: 'Work' },
        { href: 'https://www.studio.example/contact?ref=nav#form', text: 'Contact' },
      ],
      sitemap: ['https://studio.example/blog/2024/hello', 'https://studio.example/services', 'https://studio.example/about'],
    }));
    expect(pages.map((p) => [new URL(p.url).pathname, p.title, p.nav])).toEqual([
      ['/', 'Home', true],
      ['/about', 'About us', true],
      ['/work', 'Work', true],
      ['/contact', 'Contact', true],
      ['/services', 'Services', false],
      ['/blog/2024/hello', 'Hello', false],
    ]);
  });

  it('leaves out other sites, shop and account pages, archives, files and mail links', () => {
    const pages = sitePages(scan({
      nav: ['https://other.example/x', '/cart', '/account/login', '/search?q=a', '/blog/tag/news', '/menu.pdf', 'mailto:hi@studio.example', 'tel:123', '/shop'].map((href) => ({ href, text: '' })),
    }));
    expect(pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/shop']);
  });

  it('uses the page’s other links only when the menu and sitemap give little', () => {
    const links = [{ href: '/pricing', text: 'Pricing' }];
    expect(sitePages(scan({ links })).map((p) => p.title)).toEqual(['Home', 'Pricing']);
    expect(sitePages(scan({ links, nav: [{ href: '/a', text: 'A page' }, { href: '/b', text: 'B page' }] })).map((p) => p.title)).toEqual(['Home', 'A page', 'B page']);
  });

  it('lists at most 40, and ticks the start page and menu, at most 6', () => {
    const many = sitePages(scan({ sitemap: Array.from({ length: 80 }, (_, i) => `https://studio.example/p${i}`) }));
    expect(many).toHaveLength(MAX_SITE_PAGES);
    expect(defaultPicks(many)).toEqual([many[0].url]);
    const nav = sitePages(scan({ nav: Array.from({ length: 9 }, (_, i) => ({ href: `/n${i}`, text: `Page ${i}` })) }));
    expect(defaultPicks(nav)).toHaveLength(6);
  });

  it('names pages from their paths', () => {
    expect(titleFromPath('/')).toBe('Home');
    expect(titleFromPath('/about-us/')).toBe('About us');
    expect(titleFromPath('/shop/linen_dress')).toBe('Linen dress');
    expect(titleFromPath('/caf%C3%A9')).toBe('Café');
  });
});

describe('parseSitemap', () => {
  it('reads page addresses, and the children of an index (page sitemaps first)', () => {
    expect(parseSitemap('<urlset><url><loc> https://a.example/x?a=1&amp;b=2 </loc></url><url><loc><![CDATA[https://a.example/y]]></loc></url></urlset>')).toEqual({
      urls: ['https://a.example/x?a=1&b=2', 'https://a.example/y'], sitemaps: [],
    });
    const index = parseSitemap('<sitemapindex><sitemap><loc>https://a.example/post-sitemap.xml</loc></sitemap><sitemap><loc>https://a.example/page-sitemap.xml</loc></sitemap></sitemapindex>');
    expect(index.urls).toEqual([]);
    expect(childSitemaps(index.sitemaps)).toEqual(['https://a.example/page-sitemap.xml', 'https://a.example/post-sitemap.xml']);
    expect(parseSitemap('not xml')).toEqual({ urls: [], sitemaps: [] });
  });
});

const hasBrowser = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const policy: HostPolicy = async (host) =>
  host === 'public.test'
    ? { verdict: 'ok', addresses: ['127.0.0.1'] }
    : host === 'internal.test'
      ? { verdict: 'private', addresses: [] }
      : { verdict: 'unresolved', addresses: [] };

let origin: http.Server;
let port = 0;
const hits: string[] = [];
const pub = (p: string) => `http://public.test:${port}${p}`;

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = (req.url ?? '/').replace(/^https?:\/\/[^/]+/, '');
  hits.push(`${req.headers.host} ${path}`);
  if (path === '/' || path === '/home') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // The menu is built by a script, as on many site builders; one link points at an internal host.
    return res.end(`<!doctype html><title>Studio</title><header id="h"></header>
      <main><a href="/journal/first-post">Read the journal</a><a href="http://internal.test:${port}/admin">Admin</a></main>
      <script>document.getElementById('h').innerHTML = '<nav><a href="/">Home</a><a href="/about">About</a><a href="/services/">Services</a><a href="/cart">Cart</a></nav>';</script>`);
  }
  if (path === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(`<?xml version="1.0"?><urlset><url><loc>${pub('/contact')}</loc></url><url><loc>${pub('/journal/first-post')}</loc></url><url><loc>${pub('/about')}</loc></url></urlset>`);
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>Not found</title>');
}

describe.skipIf(!hasBrowser)('findSitePages in a real browser (offline)', () => {
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy };

  beforeAll(async () => {
    delete process.env.HTTP_PROXY; // plain-http test origin, reached directly by the guard proxy
    delete process.env.http_proxy;
    origin = http.createServer(serve);
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
    port = (origin.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await shutdownCapture();
    await new Promise((r) => origin.close(r));
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
  });

  it('reads the menu (built by a script) and the sitemap, and never touches internal hosts', async () => {
    hits.length = 0;
    const s = await findSitePages({ url: pub('/'), auth: null }, { policy });
    expect(s.finalUrl).toBe(pub('/'));
    expect(s.nav.map((l) => l.text)).toEqual(['Home', 'About', 'Services', 'Cart']);
    expect(s.sitemap).toEqual([pub('/contact'), pub('/journal/first-post'), pub('/about')]);
    expect(sitePages(s).map((p) => new URL(p.url).pathname)).toEqual(['/', '/about', '/services', '/contact', '/journal/first-post']);
    expect(hits.some((h) => h.startsWith('internal.test'))).toBe(false);
  }, 60_000);

  it('refuses internal and unknown hosts before opening anything', async () => {
    const code = async (url: string) => findSitePages({ url, auth: null }, { policy }).then(() => 'ok', (e: CaptureError) => e.code);
    expect(await code(`http://internal.test:${port}/`)).toBe('private');
    expect(await code(`http://nowhere.test:${port}/`)).toBe('unreachable');
  }, 30_000);
});
