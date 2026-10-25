/* Pure address checks, no DNS: IP parsing and classification, host-name rules and URL shape.
   Shared by the server guard (url-guard.ts), the dialog (instant feedback) and the unit tests.
   Everything fails closed: anything we can't parse as a public address is refused. */

/** Strict dotted-decimal IPv4 (the form WHATWG URL and dns.lookup produce) → 32-bit unsigned int. */
export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i][0] === '0') return null; // leading zeros are ambiguous (octal?)
    const v = Number(m[i]);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** IPv6 (optionally in [brackets], with an embedded IPv4 tail or a %zone) → 8 16-bit words. */
export function parseIPv6(input: string): number[] | null {
  let s = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':') || !/^[0-9a-f:.]+$/i.test(s)) return null;
  if (s.includes('.')) {
    const cut = s.lastIndexOf(':');
    const v4 = parseIPv4(s.slice(cut + 1));
    if (v4 == null) return null;
    s = `${s.slice(0, cut + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const dbl = s.indexOf('::');
  if (dbl !== s.lastIndexOf('::')) return null;
  const split = (part: string) => (part === '' ? [] : part.split(':'));
  const head = dbl >= 0 ? split(s.slice(0, dbl)) : split(s);
  const tail = dbl >= 0 ? split(s.slice(dbl + 2)) : [];
  const groups = [...head, ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  if (dbl >= 0 ? groups.length > 7 : groups.length !== 8) return null;
  const hex = (g: string) => parseInt(g, 16);
  return [...head.map(hex), ...new Array<number>(8 - groups.length).fill(0), ...tail.map(hex)];
}

const v4 = (a: number, b: number, c: number, d: number) => ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;

/** Not reachable as a public web host: private, loopback, link-local, CGNAT, documentation,
 *  benchmarking, multicast, reserved and broadcast ranges. */
const V4_REFUSED: [base: number, bits: number][] = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // CGNAT (also Alibaba's metadata 100.100.100.200)
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local, cloud metadata 169.254.169.254
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved, incl. 255.255.255.255 broadcast
];

const inRange = (n: number, base: number, bits: number) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
};

export function isPublicIPv4(n: number): boolean {
  return !V4_REFUSED.some(([base, bits]) => inRange(n, base, bits));
}

/** Only global unicast (2000::/3) is public, minus documentation and protocol blocks. Addresses that
 *  embed an IPv4 address (mapped, compatible, translated, NAT64, 6to4) are judged by that address. */
export function isPublicIPv6(w: number[]): boolean {
  if (w.length !== 8) return false;
  const embedded = () => isPublicIPv4(((w[6] << 16) >>> 0) + w[7]);
  const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && (w[5] === 0xffff || w[5] === 0)) return embedded(); // ::ffff:a.b.c.d, ::a.b.c.d (and ::, ::1)
  if (zero(0, 4) && w[4] === 0xffff && w[5] === 0) return embedded(); // ::ffff:0:a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) return embedded(); // NAT64 64:ff9b::/96
  if (w[0] === 0x2002) return isPublicIPv4(((w[1] << 16) >>> 0) + w[2]); // 6to4
  if ((w[0] & 0xe000) !== 0x2000) return false; // outside global unicast: ULA fc00::/7 (incl. fd00:ec2::254), fe80::/10, ff00::/8, ...
  if (w[0] === 0x2001 && w[1] < 0x0200) return false; // 2001::/23 protocol assignments (Teredo, ORCHID, benchmarking)
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x3fff && w[1] < 0x1000) return false; // documentation 3fff::/20
  return true;
}

/** A literal IP address (v4 dotted-decimal or v6, brackets allowed) that is public. Anything else → false. */
export function isPublicAddress(ip: string): boolean {
  const n = parseIPv4(ip);
  if (n != null) return isPublicIPv4(n);
  const w = parseIPv6(ip);
  return w != null && isPublicIPv6(w);
}

const REFUSED_SUFFIXES = ['localhost', 'local', 'internal', 'localdomain', 'home.arpa', 'lan', 'home', 'corp', 'intranet', 'private'];
const REFUSED_NAMES = ['metadata', 'metadata.google.internal', 'instance-data', 'metadata.azure.internal'];

/** Host names that never point at a public site: localhost, *.localhost, *.local, *.internal, other
 *  private-use suffixes, cloud metadata names and single-label hosts. */
export function isRefusedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '');
  if (!h || !h.includes('.')) return true;
  return REFUSED_NAMES.includes(h) || REFUSED_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

export type UrlVerdict = { ok: true; url: URL } | { ok: false; code: 'invalid_url' | 'scheme' | 'private' };

/** Checks everything that doesn't need DNS. WHATWG URL parsing normalizes odd IPv4 forms
 *  (http://2130706433, http://0x7f.1, http://127.1) to dotted-decimal and IPv6 to its short form,
 *  so the literal checks below see canonical addresses. */
export function checkUrlShape(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'scheme' };
  const host = url.hostname;
  if (!host) return { ok: false, code: 'invalid_url' };
  if (host.startsWith('[')) return isPublicAddress(host) ? { ok: true, url } : { ok: false, code: 'private' };
  const n = parseIPv4(host);
  if (n != null) return isPublicIPv4(n) ? { ok: true, url } : { ok: false, code: 'private' };
  if (/^[\d.]+$/.test(host)) return { ok: false, code: 'invalid_url' }; // numeric but not a canonical IPv4
  return isRefusedHostname(host) ? { ok: false, code: 'private' } : { ok: true, url };
}
