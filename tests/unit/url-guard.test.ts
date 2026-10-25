import { describe, expect, it, vi } from 'vitest';
import {
  checkHost,
  checkUrl,
  checkUrlShape,
  createRequestGuard,
  isPublicAddress,
  isRefusedHostname,
  parseIPv4,
  parseIPv6,
  publicOnly,
  type Lookup,
} from '@/lib/capture/url-guard';
import { CaptureError } from '@/lib/capture/errors';

const PUBLIC_MESSAGE = 'Only public web addresses can be captured.';

/** Fake DNS: name → addresses; unknown names fail like ENOTFOUND. */
function fakeDns(table: Record<string, string[]>): Lookup & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (host: string) => {
    calls.push(host);
    const hit = table[host];
    if (!hit) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return hit;
  }) as Lookup & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const dns = () =>
  fakeDns({
    'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
    'public.example': ['93.184.215.14'],
    'rebind.example': ['93.184.215.14', '127.0.0.1'],
    'intranet.example': ['10.0.0.5'],
    'v6loop.example': ['::1'],
    'mapped.example': ['::ffff:192.168.1.1'],
    'ula.example': ['fd12:3456::1'],
    'empty.example': [],
  });

async function refusal(p: Promise<unknown>): Promise<CaptureError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CaptureError) return e;
    throw e;
  }
  throw new Error('expected a CaptureError');
}

describe('parseIPv4', () => {
  it('parses dotted decimal', () => {
    expect(parseIPv4('127.0.0.1')).toBe(0x7f000001);
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
    expect(parseIPv4('0.0.0.0')).toBe(0);
  });
  it('rejects anything else', () => {
    for (const s of ['256.0.0.1', '1.2.3', '1.2.3.4.5', '0x7f.0.0.1', '017.0.0.1', '2130706433', 'a.b.c.d', '']) expect(parseIPv4(s)).toBeNull();
  });
});

describe('parseIPv6', () => {
  it('expands :: and embedded IPv4', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('[fe80::1%eth0]')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('2001:db8:0:0:0:0:2:1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 2, 1]);
  });
  it('rejects malformed input', () => {
    for (const s of [':::', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', 'g::1', '1.2.3.4', '::1.2.3', '']) expect(parseIPv6(s)).toBeNull();
  });
});

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '100.100.100.200', '127.0.0.1', '127.255.0.9',
    '169.254.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.168.0.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ])('refuses IPv4 %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    '::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1', 'fec0::1', '100::1', '64:ff9b:1::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::127.0.0.1', '::ffff:0:192.168.1.1',
    '64:ff9b::10.0.0.1', '2002:c0a8:101::1', '2002:7f00:1::', '2001:db8::1', '2001::1', '2001:10::1', '3fff::1', '[::1]',
  ])('refuses IPv6 %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['93.184.215.14', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.169.0.1', '223.255.255.255'])(
    'allows public IPv4 %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each(['2606:4700::6810:84e5', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '2002:808:808::1', '[2606:4700::1]'])(
    'allows public IPv6 %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it('refuses things that are not addresses', () => {
    for (const s of ['localhost', 'example.com', '', '1.2.3', '010.0.0.1']) expect(isPublicAddress(s)).toBe(false);
  });
});

describe('isRefusedHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'printer.local', 'db.internal', 'metadata.google.internal', 'metadata', 'intranet', 'nas.home.arpa', 'router.lan', 'x.corp'])(
    'refuses %s',
    (h) => expect(isRefusedHostname(h)).toBe(true),
  );
  it.each(['example.com', 'www.example.co.uk', 'localhost.example.com', 'internal.example.com'])('allows %s', (h) => expect(isRefusedHostname(h)).toBe(false));
});

describe('checkUrlShape (no DNS)', () => {
  it.each([
    ['http://localhost', 'private'],
    ['http://localhost:3000/x', 'private'],
    ['http://LOCALHOST./', 'private'],
    ['http://foo.localhost', 'private'],
    ['http://192.168.1.1', 'private'],
    ['http://169.254.169.254/latest/meta-data/', 'private'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'private'],
    ['http://metadata/', 'private'],
    ['http://printer.local', 'private'],
    ['http://intranet/', 'private'],
    ['http://2130706433', 'private'], // 127.0.0.1 as one number
    ['http://0x7f.1', 'private'], // hex + short form
    ['http://0x7f000001', 'private'],
    ['http://127.1', 'private'],
    ['http://0177.0.0.1', 'private'], // octal
    ['http://0', 'private'], // 0.0.0.0
    ['http://3232235777', 'private'], // 192.168.1.1
    ['http://0xa9.0xfe.0xa9.0xfe', 'private'], // 169.254.169.254
    ['http://[::1]', 'private'],
    ['http://[::ffff:127.0.0.1]', 'private'],
    ['http://[::ffff:169.254.169.254]/', 'private'],
    ['http://[0:0:0:0:0:ffff:7f00:1]', 'private'],
    ['http://[::127.0.0.1]', 'private'],
    ['http://[fd00:ec2::254]', 'private'],
    ['http://[fe80::1]', 'private'],
    ['https://[64:ff9b::a9fe:a9fe]', 'private'],
    ['ftp://example.com/file', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['example.com', 'invalid_url'],
    ['http://', 'invalid_url'],
    ['http://exa mple.com', 'invalid_url'],
    ['http://999.1.1.1', 'invalid_url'],
  ])('%s → %s', (url, code) => {
    const v = checkUrlShape(url);
    expect(v.ok ? 'ok' : v.code).toBe(code);
  });

  it.each(['https://example.com', 'http://example.com/pricing?x=1#top', 'https://93.184.215.14/', 'https://[2606:4700::6810:84e5]/', 'https://xn--bcher-kva.example/'])(
    'passes %s',
    (url) => expect(checkUrlShape(url).ok).toBe(true),
  );
});

describe('checkUrl (with DNS)', () => {
  it.each(['http://localhost', 'http://192.168.1.1', 'http://169.254.169.254', 'http://[::ffff:127.0.0.1]', 'http://2130706433'])(
    'refuses %s with the public-address message, without a lookup',
    async (url) => {
      const lookup = dns();
      const err = await refusal(checkUrl(url, publicOnly(lookup)));
      expect(err.code).toBe('private');
      expect(err.message).toBe(PUBLIC_MESSAGE);
      expect(lookup.calls).toEqual([]);
    },
  );

  it('accepts a public host', async () => {
    const url = await checkUrl('https://example.com/pricing', publicOnly(dns()));
    expect(url.href).toBe('https://example.com/pricing');
  });

  it('refuses a host with any private address', async () => {
    for (const host of ['rebind.example', 'intranet.example', 'v6loop.example', 'mapped.example', 'ula.example']) {
      const err = await refusal(checkUrl(`https://${host}/`, publicOnly(dns())));
      expect(err.code, host).toBe('private');
      expect(err.message).toBe(PUBLIC_MESSAGE);
    }
  });

  it('reports names that do not resolve as unreachable', async () => {
    for (const host of ['nope.example', 'empty.example']) {
      const err = await refusal(checkUrl(`https://${host}/`, publicOnly(dns())));
      expect(err.code).toBe('unreachable');
      expect(err.message).toMatch(/Couldn’t find that site/);
    }
  });

  it('refuses ftp:// and nonsense', async () => {
    expect((await refusal(checkUrl('ftp://example.com/', publicOnly(dns())))).code).toBe('invalid_url');
    expect((await refusal(checkUrl('not a url', publicOnly(dns())))).code).toBe('invalid_url');
  });

  it('uses the system resolver by default', async () => {
    expect(await checkHost('localhost')).toBe('private'); // name rule, no lookup needed
  });
});

describe('createRequestGuard (every request, every redirect hop)', () => {
  it('refuses a redirect from a public page to the metadata service', async () => {
    const guard = createRequestGuard(publicOnly(dns()));
    // The browser asks about each hop in turn: the public start page, then where it redirects.
    expect(await guard('https://public.example/redirect?to=metadata')).toBe('ok');
    expect(await guard('http://169.254.169.254/latest/meta-data/')).toBe('private');
    expect(await guard('http://intranet.example/admin')).toBe('private');
    expect(await guard('http://[::ffff:a9fe:a9fe]/')).toBe('private');
  });

  it('checks subresources and WebSockets too', async () => {
    const guard = createRequestGuard(publicOnly(dns()));
    expect(await guard('https://example.com/app.js')).toBe('ok');
    expect(await guard('http://192.168.1.1/router.png')).toBe('private');
    expect(await guard('ws://localhost:8080/socket')).toBe('private');
    expect(await guard('wss://example.com/live')).toBe('ok');
  });

  it('lets in-browser URLs through and refuses other schemes', async () => {
    const guard = createRequestGuard(publicOnly(dns()));
    expect(await guard('data:image/png;base64,AAAA')).toBe('ok');
    expect(await guard('blob:https://example.com/123')).toBe('ok');
    expect(await guard('file:///etc/passwd')).toBe('scheme');
    expect(await guard('chrome://settings')).toBe('scheme');
  });

  it('caches DNS answers per host for the capture', async () => {
    const lookup = dns();
    const guard = createRequestGuard(publicOnly(lookup));
    await Promise.all([guard('https://example.com/a'), guard('https://example.com/b'), guard('https://EXAMPLE.com/c')]);
    await guard('https://public.example/');
    expect(lookup.calls).toEqual(['example.com', 'public.example']);
    const other = createRequestGuard(publicOnly(lookup));
    await other('https://example.com/');
    expect(lookup.calls).toHaveLength(3); // a new capture asks again
  });

  it('refuses hosts that do not resolve', async () => {
    const guard = createRequestGuard(publicOnly(dns()));
    expect(await guard('https://nope.example/')).toBe('unresolved');
  });
});

describe('checkHost', () => {
  it('passes the bare, lower-cased host name to the resolver', async () => {
    const spy = vi.fn(async () => ['8.8.8.8']);
    expect(await checkHost('DNS.Example.', spy)).toBe('ok');
    expect(spy).toHaveBeenCalledWith('dns.example');
  });
});
