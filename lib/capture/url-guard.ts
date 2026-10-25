/* Server-side URL safety check: only public web addresses can be captured. The pure parts (IP
   parsing, ranges, host-name rules) live in address.ts; this file adds DNS. Every connection the
   capture browser makes goes through guard-proxy.ts, which asks the request guard about each host
   (every redirect hop, subresource and WebSocket) and connects only to the addresses checked here. */
import { lookup as dnsLookup } from 'node:dns/promises';
import { checkUrlShape, isPublicAddress, isRefusedHostname, parseIPv4 } from './address';
import { CaptureError, NOT_FOUND_MESSAGE, SCHEME_MESSAGE } from './errors';

export * from './address';

/** Resolves a host name to every address it has. Injected in tests. */
export type Lookup = (host: string) => Promise<string[]>;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

export type HostVerdict = 'ok' | 'private' | 'unresolved';
export interface HostCheck {
  verdict: HostVerdict;
  /** The addresses that were checked; connect only to these. Empty unless the verdict is 'ok'. */
  addresses: string[];
}

/** Decides whether a host may be contacted. The real one is publicOnly(); tests can swap it. */
export type HostPolicy = (hostname: string) => Promise<HostCheck>;

const bare = (hostname: string) => hostname.toLowerCase().replace(/\.+$/, '');

/** A host is public when it isn't a refused name and every address it resolves to is public. */
export async function resolveHost(hostname: string, lookup: Lookup = systemLookup): Promise<HostCheck> {
  const h = bare(hostname);
  const refused = (verdict: HostVerdict): HostCheck => ({ verdict, addresses: [] });
  if (h.startsWith('[') || parseIPv4(h) != null) {
    return isPublicAddress(h) ? { verdict: 'ok', addresses: [h.replace(/^\[|\]$/g, '')] } : refused('private');
  }
  if (isRefusedHostname(h)) return refused('private');
  let addrs: string[];
  try {
    addrs = await lookup(h);
  } catch {
    return refused('unresolved');
  }
  if (!addrs.length) return refused('unresolved');
  if (!addrs.every(isPublicAddress)) return refused('private');
  return { verdict: 'ok', addresses: addrs };
}

export async function checkHost(hostname: string, lookup: Lookup = systemLookup): Promise<HostVerdict> {
  return (await resolveHost(hostname, lookup)).verdict;
}

/** The production policy: DNS, and every address must be public. */
export const publicOnly =
  (lookup: Lookup = systemLookup): HostPolicy =>
  (host) =>
    resolveHost(host, lookup);

/** Validates the address the user asked for. Throws CaptureError (invalid_url, private, unreachable). */
export async function checkUrl(raw: string, policy: HostPolicy = publicOnly()): Promise<URL> {
  const shape = checkUrlShape(raw);
  if (!shape.ok) {
    if (shape.code === 'scheme') throw new CaptureError('invalid_url', SCHEME_MESSAGE);
    throw new CaptureError(shape.code);
  }
  const { verdict } = await policy(bare(shape.url.hostname));
  if (verdict === 'private') throw new CaptureError('private');
  if (verdict === 'unresolved') throw new CaptureError('unreachable', NOT_FOUND_MESSAGE);
  return shape.url;
}

export type RequestVerdict = HostVerdict | 'scheme';

export interface RequestGuard {
  /** Verdict for a URL the browser wants to load. */
  (url: string): Promise<RequestVerdict>;
  /** Verdict and checked addresses for a host (used by the guard proxy). */
  host(hostname: string): Promise<HostCheck>;
}

/** One capture's guard, with answers cached per host for the length of the capture. */
export function createRequestGuard(policy: HostPolicy = publicOnly()): RequestGuard {
  const cache = new Map<string, Promise<HostCheck>>();
  const host = (hostname: string) => {
    const key = bare(hostname);
    let p = cache.get(key);
    if (!p) {
      p = policy(key).catch((): HostCheck => ({ verdict: 'unresolved', addresses: [] }));
      cache.set(key, p);
    }
    return p;
  };
  const guard = (async (raw: string): Promise<RequestVerdict> => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return 'scheme';
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return 'ok'; // never leave the browser
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return 'scheme';
    return (await host(u.hostname)).verdict;
  }) as RequestGuard;
  guard.host = host;
  return guard;
}
