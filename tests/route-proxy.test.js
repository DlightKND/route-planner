import { describe, it, expect, vi } from 'vitest';
import { trustedRouteProxy, requestRouteProxy } from '../src/core/route-proxy.js';
const project = 'https://example.supabase.co';
const endpoint = project + '/functions/v1/ors';
describe('ORS bearer token destination', () => {
  it('accepts only the connected project ORS function', () => {
    expect(trustedRouteProxy(endpoint, project)).toBe(endpoint);
    expect(trustedRouteProxy(endpoint + '/', project)).toBe(endpoint + '/');
    expect(trustedRouteProxy('http://127.0.0.1:54321/functions/v1/ors', 'http://127.0.0.1:54321')).toContain('127.0.0.1');
  });
  it.each([
    'https://other.supabase.co/functions/v1/ors',
    'https://example.supabase.co.attacker.test/functions/v1/ors',
    'https://example.supabase.co@attacker.test/functions/v1/ors',
    'https://name:password@example.supabase.co/functions/v1/ors',
    endpoint + '?redirect=https://attacker.test', endpoint + '#fragment',
    project + '/functions/v1/other', 'http://example.supabase.co/functions/v1/ors',
    '/functions/v1/ors', 'javascript:alert(1)', '',
  ])('does not send a token to %s', url => {
    const fetcher = vi.fn();
    expect(() => requestRouteProxy(url, project, 'fake-test-token', {}, fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('disables redirect following and browser cookies on the actual request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await requestRouteProxy(endpoint, project, 'fake-test-token', { path: 'v2/directions' }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      redirect: 'error', credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer fake-test-token' }),
    }));
  });
});
