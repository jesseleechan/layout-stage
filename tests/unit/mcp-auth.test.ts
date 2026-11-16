import { describe, expect, it } from 'vitest';
import { mcpAccess } from '@/lib/mcp/auth';

const GOOD_TOKEN = '0123456789abcdef0123456789abcdef';

describe('mcpAccess', () => {
  it('returns off when MCP_TOKEN is unset or shorter than 24 characters', () => {
    const req = new Request(`https://example.com/api/mcp?key=${GOOD_TOKEN}`);
    expect(mcpAccess(req, {})).toBe('off');
    expect(mcpAccess(req, { MCP_TOKEN: '' })).toBe('off');
    expect(mcpAccess(req, { MCP_TOKEN: 'too-short-1234567890123' })).toBe('off');
  });

  it('accepts the right token via Authorization Bearer or ?key=', () => {
    const env = { MCP_TOKEN: GOOD_TOKEN };
    const bearerReq = new Request('https://example.com/api/mcp', {
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(mcpAccess(bearerReq, env)).toBe('ok');

    const queryReq = new Request(`https://example.com/api/mcp?key=${GOOD_TOKEN}`);
    expect(mcpAccess(queryReq, env)).toBe('ok');
  });

  it('denies missing or wrong tokens and ignores x-vercel-protection-bypass', () => {
    const env = { MCP_TOKEN: GOOD_TOKEN };
    expect(mcpAccess(new Request('https://example.com/api/mcp'), env)).toBe('denied');
    expect(mcpAccess(new Request('https://example.com/api/mcp?key=wrong-token'), env)).toBe('denied');
    expect(mcpAccess(new Request('https://example.com/api/mcp', {
      headers: { authorization: 'Bearer wrong-token' },
    }), env)).toBe('denied');
    expect(mcpAccess(new Request(`https://example.com/api/mcp?x-vercel-protection-bypass=secret&key=${GOOD_TOKEN}`), env)).toBe('ok');
    expect(mcpAccess(new Request('https://example.com/api/mcp?x-vercel-protection-bypass=secret'), env)).toBe('denied');
  });
});
