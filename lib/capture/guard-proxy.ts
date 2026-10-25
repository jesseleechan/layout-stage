/* A local forward proxy that every connection of the capture browser goes through. For each
   connection it asks the current request guard about the host, refuses anything that isn't public,
   and connects to an address it checked (so DNS can't change its answer in between). Because the
   browser opens a new connection or request for each redirect hop, subresource, iframe and
   WebSocket, all of them are checked; Playwright's request routing never sees redirect hops.
   Chains to an upstream proxy from HTTPS_PROXY / HTTP_PROXY (minus NO_PROXY) when one is set.
   Browser-agnostic: any Chromium takes it with --proxy-server. Server only. */
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { HostCheck, RequestGuard } from './url-guard';

export interface Upstream {
  https?: URL;
  http?: URL;
  noProxy: string[];
}

export function upstreamFromEnv(env: Record<string, string | undefined> = process.env): Upstream {
  const parse = (v?: string) => {
    if (!v) return undefined;
    try {
      return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `http://${v}`);
    } catch {
      return undefined;
    }
  };
  return {
    https: parse(env.HTTPS_PROXY || env.https_proxy),
    http: parse(env.HTTP_PROXY || env.http_proxy),
    noProxy: (env.NO_PROXY || env.no_proxy || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** NO_PROXY: "*", exact names, and ".suffix" / "*.suffix" entries (IP ranges never get here: they're refused). */
export function bypassesProxy(host: string, noProxy: string[]): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return noProxy.some((e) => {
    if (e === '*') return true;
    const suffix = e.replace(/^\*?\./, '');
    return h === suffix || (e.startsWith('.') || e.startsWith('*.') ? h.endsWith(`.${suffix}`) : false);
  });
}

/** "example.com:443", "[2606:4700::1]:443" → host and port. */
export function parseAuthority(a: string): { host: string; port: number } | null {
  const m = /^(\[[0-9a-f:.]+\]|[^:/\s[\]]+):(\d{1,5})$/i.exec(a);
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1].toLowerCase(), port } : null;
}

export interface GuardProxy {
  /** The --proxy-server value for the browser. */
  readonly url: string;
  /** Switches to the next capture's guard (captures run one at a time). */
  setGuard(guard: RequestGuard): void;
  close(): Promise<void>;
}

const CONNECT_TIMEOUT = 15_000;
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'upgrade'];

/** Tries the checked addresses in turn (IPv4 first). */
function connectAny(addresses: string[], port: number): Promise<net.Socket> {
  const list = [...addresses].sort((a, b) => Number(a.includes(':')) - Number(b.includes(':'))).slice(0, 4);
  return list.reduce<Promise<net.Socket>>(
    (prev, address) =>
      prev.catch(
        () =>
          new Promise((resolve, reject) => {
            const s = net.connect({ host: address, port });
            s.setTimeout(CONNECT_TIMEOUT, () => s.destroy(new Error('connect timeout')));
            s.once('connect', () => {
              s.setTimeout(0);
              s.off('error', reject);
              resolve(s);
            });
            s.once('error', reject);
          }),
      ),
    Promise.reject(new Error('no address')),
  );
}

const basicAuth = (u: URL) => (u.username ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}` : '');

/** Opens a CONNECT tunnel to host:port through an upstream HTTP proxy. */
function tunnelVia(proxy: URL, authority: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: proxy.hostname.replace(/^\[|\]$/g, ''), port: Number(proxy.port) || 80 });
    s.setTimeout(CONNECT_TIMEOUT, () => s.destroy(new Error('upstream timeout')));
    s.once('error', reject);
    s.once('connect', () => {
      const auth = basicAuth(proxy);
      s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buf.length > 32_768) s.destroy(new Error('upstream header too large'));
        return;
      }
      s.off('data', onData);
      const ok = /^HTTP\/1\.[01] 200/.test(buf.toString('latin1', 0, end));
      if (!ok) {
        s.destroy();
        reject(new Error('upstream refused'));
        return;
      }
      s.setTimeout(0);
      s.off('error', reject);
      const rest = buf.subarray(end + 4);
      if (rest.length) s.unshift(rest);
      resolve(s);
    };
    s.on('data', onData);
  });
}

function refuse(socket: Duplex, status: number, reason: string) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

export async function startGuardProxy(initial: RequestGuard, upstream: Upstream = upstreamFromEnv()): Promise<GuardProxy> {
  let guard = initial;
  const sockets = new Set<Duplex>();
  const track = (s: Duplex) => {
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
  };

  const check = (host: string): Promise<HostCheck> => guard.host(host).catch(() => ({ verdict: 'unresolved' as const, addresses: [] }));

  const server = http.createServer();

  // https:// and wss:// (and ws:// — Chromium tunnels WebSockets): CONNECT host:port.
  server.on('connect', (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on('error', () => client.destroy());
    void (async () => {
      const target = parseAuthority(req.url ?? '');
      if (!target) return refuse(client, 400, 'Bad Request');
      const res = await check(target.host);
      if (res.verdict !== 'ok') return refuse(client, 403, 'Forbidden');
      const authority = `${target.host}:${target.port}`;
      let up: net.Socket;
      try {
        up = upstream.https && !bypassesProxy(target.host, upstream.noProxy) ? await tunnelVia(upstream.https, authority) : await connectAny(res.addresses, target.port);
      } catch {
        return refuse(client, 502, 'Bad Gateway');
      }
      if (client.destroyed) return void up.destroy();
      track(up);
      up.on('error', () => client.destroy());
      client.on('close', () => up.destroy());
      up.on('close', () => client.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    })();
  });

  // Plain http://: absolute-form requests.
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(req.url ?? '');
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (url.protocol !== 'http:') return void res.writeHead(400).end();
      const checked = await check(url.hostname);
      if (checked.verdict !== 'ok') return void res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Only public web addresses can be captured.');
      const headers: http.OutgoingHttpHeaders = { ...req.headers };
      HOP_BY_HOP.forEach((h) => delete headers[h]);
      const viaProxy = upstream.http && !bypassesProxy(url.hostname, upstream.noProxy) ? upstream.http : null;
      if (viaProxy && basicAuth(viaProxy)) headers['proxy-authorization'] = basicAuth(viaProxy);
      const address = [...checked.addresses].sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')))[0];
      const out = http.request(
        viaProxy
          ? { host: viaProxy.hostname.replace(/^\[|\]$/g, ''), port: Number(viaProxy.port) || 80, path: url.href, method: req.method, headers }
          : { host: address, port: Number(url.port) || 80, path: url.pathname + url.search, method: req.method, headers },
        (r) => {
          const h = { ...r.headers };
          HOP_BY_HOP.forEach((k) => delete h[k]);
          res.writeHead(r.statusCode ?? 502, r.statusMessage, h);
          r.pipe(res);
          r.on('error', () => res.destroy());
        },
      );
      out.setTimeout(CONNECT_TIMEOUT * 2, () => out.destroy(new Error('timeout')));
      out.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(out);
    })();
  });
  server.on('connection', track);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setGuard(next) {
      guard = next;
    },
    close() {
      sockets.forEach((s) => s.destroy());
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
